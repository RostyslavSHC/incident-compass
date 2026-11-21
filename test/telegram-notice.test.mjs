import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

test('Telegram acknowledgement and automatic test routing',async t=>{
  const folder = await mkdtemp(join(tmpdir(),'incident-compass-telegram-'));
  const files = ['telegram-routing.mjs','public/data.mjs','public/simulations.mjs'];
  const settings = '.telegram-routing.local.json';
  t.after(async()=>{
    await Promise.all([...files,settings].map(name=>unlink(join(folder,name))));
    await rmdir(join(folder,'public'));
    await rmdir(folder);
  });
  await mkdir(join(folder,'public'));
  await Promise.all(files.map(name=>copyFile(new URL('../'+name,import.meta.url),join(folder,name))));
  const team = {chat:'-1000012345',label:'Example team'};
  const person = {id:'operator',chat:'100004321',group:team.chat,label:'Example responder'};
  await writeFile(join(folder,settings),JSON.stringify({
    routes:[],offsets:{},connections:{'900000000':{team,people:[person],auto:{enabled:true,owner:'default',wait:30}}}
  }));
  const {createTelegramRouter} = await import(pathToFileURL(join(folder,'telegram-routing.mjs')));
  const sent = [];
  const edits = [];
  const updates = [];
  let clock = Date.parse('2026-11-21T20:00:00Z');
  let updateId = 0;
  const owner = '100004322';
  let profileLookups = 0;
  const router = createTelegramRouter({
    connect:async()=>({token:'900000000:mock',owner}),
    now:()=>clock,
    call:async(token,method,body)=>{
      if (method==='getChatMember') return {ok:true,result:{status:'member'}};
      if (method==='getWebhookInfo') return {ok:true,result:{url:''}};
      if (method==='getUpdates') return {ok:true,result:updates.splice(0)};
      if (method==='answerCallbackQuery') return {ok:true};
      if (method==='editMessageText') {
        edits.push(body);
        return {ok:true};
      }
      if (method==='getChat') {
        assert.equal(body.chat_id,owner);
        profileLookups++;
        return {ok:true,result:{type:'private',id:Number(owner),first_name:'Example',last_name:'Owner'}};
      }
      assert.equal(method,'sendMessage');
      sent.push(body);
      return {ok:true,result:{message_id:sent.length}};
    },
  });
  const callback = (message,action,user=message.chat_id)=>{
    const button = message.reply_markup.inline_keyboard.flat().find(item=>item.callback_data?.endsWith(':'+action));
    assert.ok(button);
    updates.push({update_id:++updateId,callback_query:{id:String(updateId),data:button.callback_data,
      from:{id:Number(user),first_name:'Example responder'},message:{chat:{id:Number(message.chat_id)},message_id:sent.indexOf(message)+1}
    }});
  };
  const input = {
    incident:'SIM-ABC12345',level:'P4',simulation:{
      title:'A <synthetic> notification', description:'Test only',actions:'Check the queue',
      service:'Reporting',status:'reported'
    }
  };
  const group = await router.previewNotice({...input,recipient:'team'});
  const direct = await router.previewNotice({...input,recipient:person.id});
  const [routing,defaultPreview] = await Promise.all([router.list(),router.previewNotice({...input,recipient:'default'})]);
  assert.equal(routing.people.find(person=>person.id==='default').label,'Example Owner');
  assert.equal(defaultPreview.label,'Example Owner');
  assert.equal(profileLookups,1);
  assert.equal(group.group,true);
  assert.equal(direct.group,false);
  assert.equal(direct.test,true);
  assert.match(direct.text,/TEST EVENT/);
  assert.match(direct.text,/<synthetic>/);
  assert.match(direct.text,/Respond within 30 seconds/);
  assert.equal(sent.length,0);
  assert.ok((await router.recordAlert({...input,event:'invalid-test-event',simulation:undefined})).error);
  assert.ok((await router.sendNotice({token:direct.token,confirm:false})).error);
  const privatePage = await router.sendNotice({token:direct.token,confirm:true});
  assert.equal(privatePage.route.stage,'queued-private');
  const repeatedPreview = await router.previewNotice({...input,recipient:person.id});
  assert.equal((await router.sendNotice({token:repeatedPreview.token,confirm:true})).route.id,privatePage.route.id);
  assert.equal((await router.sendNotice({token:group.token,confirm:true})).status,'accepted');
  assert.ok((await router.sendNotice({token:direct.token,confirm:true})).error);
  await router.step();
  assert.deepEqual(sent.map(message=>message.chat_id),[team.chat,person.chat]);
  assert.match(sent[1].text,/&lt;synthetic&gt;/);
  assert.match(sent[1].text,/Reply by/);
  assert.equal((await router.list()).routes.find(route=>route.id===privatePage.route.id).deadline,clock+30_000);
  callback(sent[1],'accept');
  await router.step();
  assert.equal((await router.list()).routes.find(route=>route.id===privatePage.route.id).stage,'accepted');
  assert.match(edits.at(-1).text,/Accepted by Example responder/);
  assert.ok((await router.previewNotice({...input,recipient:'team',simulation:undefined})).error);
  const prepared = await router.previewNotice({incident:'INC-124',level:'P3',recipient:'team'});
  assert.equal(prepared.test,false);
  assert.match(prepared.text,/Scheduled reports delayed/);

  const record = (incident,level)=>router.recordAlert({...input,incident,level,event:'simulation-'+incident});
  await t.test('decline escalates to the group and a teammate can claim it',async()=>{
    const page = await record('SIM-A1111111','P2');
    assert.equal(page.route.stage,'queued-private');
    assert.equal((await record('SIM-A1111111','P2')).route.id,page.route.id);
    await router.step();
    const message = sent.at(-1);
    assert.equal(message.chat_id,owner);
    callback(message,'decline');
    await router.step();
    const escalation = sent.at(-1);
    assert.equal(escalation.chat_id,team.chat);
    assert.match(escalation.text,/Responder declined/);
    callback(escalation,'claim',owner);
    await router.step();
    assert.equal((await router.list()).routes.find(route=>route.id===page.route.id).stage,'accepted');
  });
  await t.test('no reply by the deadline escalates and removes the private actions',async()=>{
    await record('SIM-A2222222','P3');
    await router.step();
    const late = sent.at(-1);
    clock+=30_001;
    callback(late,'accept');
    await router.step();
    assert.equal(sent.at(-1).chat_id,team.chat);
    assert.match(sent.at(-1).text,/No response before the deadline/);
    assert.deepEqual(edits.at(-1).reply_markup.inline_keyboard,[]);
  });
  await t.test('critical test alerts go straight to the group',async()=>{
    const count = sent.length;
    const page = await record('SIM-A3333333','P1');
    assert.equal(page.route.stage,'queued-team');
    await router.step();
    assert.equal(sent.length,count+1);
    assert.equal(sent.at(-1).chat_id,team.chat);
    assert.match(sent.at(-1).text,/TEST EVENT/);
    assert.match(sent.at(-1).text,/Immediate routing/);
  });
});
