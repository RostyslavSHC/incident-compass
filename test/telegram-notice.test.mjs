import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

test('test incident notices preview safely and send once to the selected chat',async t=>{
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
    routes:[],offsets:{},connections:{'900000000':{team,people:[person]}}
  }));
  const {createTelegramRouter} = await import(pathToFileURL(join(folder,'telegram-routing.mjs')));
  const sent = [];
  const owner = '100004322';
  let profileLookups = 0;
  const router = createTelegramRouter({
    connect:async()=>({token:'900000000:mock',owner}),
    call:async(token,method,body)=>{
      if (method==='getChatMember') return {ok:true,result:{status:'member'}};
      if (method==='getChat') {
        assert.equal(body.chat_id,owner);
        profileLookups++;
        return {ok:true,result:{type:'private',id:Number(owner),first_name:'Example',last_name:'Owner'}};
      }
      assert.equal(method,'sendMessage');
      sent.push(body);
      return {ok:true,result:{message_id:1}};
    },
  });
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
  assert.equal(sent.length,0);
  assert.ok((await router.recordAlert({...input,event:'not-a-prepared-event'})).error);
  assert.ok((await router.sendNotice({token:direct.token,confirm:false})).error);
  assert.equal((await router.sendNotice({token:direct.token,confirm:true})).status,'accepted');
  assert.equal((await router.sendNotice({token:group.token,confirm:true})).status,'accepted');
  assert.ok((await router.sendNotice({token:direct.token,confirm:true})).error);
  assert.deepEqual(sent.map(message=>message.chat_id),[person.chat,team.chat]);
  assert.match(sent[0].text,/&lt;synthetic&gt;/);
  assert.ok((await router.previewNotice({...input,recipient:'team',simulation:undefined})).error);
  const prepared = await router.previewNotice({incident:'INC-124',level:'P3',recipient:'team'});
  assert.equal(prepared.test,false);
  assert.match(prepared.text,/Scheduled reports delayed/);
});
