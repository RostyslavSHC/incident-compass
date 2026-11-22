import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

test('team members can pair Telegram, confirm new email addresses, edit email, and remove both channels',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'aurelis-team-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  await mkdir(join(folder,'public'));
  const files=['alerts.mjs','telegram-routing.mjs','email-alerts.mjs','public/data.mjs','public/simulations.mjs'];
  await Promise.all(files.map(file=>copyFile(new URL('../'+file,import.meta.url),join(folder,file))));
  const owner='123456789';
  const newChat=234567890;
  await writeFile(join(folder,'.alert-providers.local.json'),JSON.stringify({
    TELEGRAM_BOT_TOKEN:'900000000:example-test-token-12345',TELEGRAM_CHAT_ID:owner,
    RESEND_API_KEY:'re_fixture-test-only',ALERT_EMAIL_FROM:'alerts@example.com',
  }));
  await writeFile(join(folder,'.alert-recipients.local.json'),JSON.stringify({email:['owner@example.com','legacy@example.com']}));
  await writeFile(join(folder,'.alert-email.local.json'),JSON.stringify({enabled:true,entries:[]}));
  const {createAlertApi}=await import(pathToFileURL(join(folder,'alerts.mjs')));
  const updates=[];
  const unexpected=[];
  const confirmations=[];
  let emailOnline=true;
  let telegramOnline=true;
  const api=createAlertApi({port:4555,json:(_,status,data)=>({status,data}),request:async(url,options)=>{
    const method=new URL(url).pathname.split('/').at(-1);
    if (new URL(url).hostname==='api.resend.com' && method==='emails') {
      confirmations.push(JSON.parse(options.body));
      return Response.json(emailOnline?{id:'email-'+confirmations.length}:{}, {status:emailOnline?200:503});
    }
    if (!telegramOnline) throw Error('Telegram DNS unavailable');
    if (method==='getMe') return Response.json({ok:true,result:{username:'AurelisTestBot'}});
    if (method==='getChat') return Response.json({ok:true,result:{id:Number(JSON.parse(options.body).chat_id),type:'private',first_name:'Example'}});
    if (method==='getUpdates') return Response.json({ok:true,result:updates.splice(0)});
    if (method==='getWebhookInfo') return Response.json({ok:true,result:{url:''}});
    unexpected.push(method);
    throw Error('Unexpected provider action');
  }});
  const call=(action,body)=>api(Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []),{
    method:body?'POST':'GET',headers:{host:'127.0.0.1:4555',origin:'http://127.0.0.1:4555','content-type':'application/json'},
  }),{},'/api/alerts/'+action);

  const invalid=await call('team-members',{name:'Missing email'});
  assert.equal(invalid.status,400);
  const linked=await call('team-members',{name:'Team owner',email:'OWNER@example.com',telegram:'default'});
  assert.equal(linked.status,200);
  assert.equal(linked.data.member.telegram.id,'default');
  assert.equal(linked.data.member.email,'ow•••@example.com');
  assert.equal(confirmations.length,0);
  const conflict=await call('team-members',{name:'Second owner',email:'different@example.com',telegram:'default'});
  assert.equal(conflict.status,409);
  const saved=await call('team-members',{name:'New member',email:'member@example.com'});
  assert.equal(saved.status,200);
  assert.equal(saved.data.member.telegram,null);
  assert.equal(saved.data.confirmation.status,'accepted');
  assert.deepEqual(confirmations[0].to,['member@example.com']);
  assert.match(confirmations[0].text,/added to Aurelis incident notifications/);
  const startInvite={action:'start',mode:'responder',member:saved.data.member.id};
  const firstInvite=await call('telegram-discover',startInvite);
  assert.equal(firstInvite.status,200);
  telegramOnline=false;
  assert.equal((await call('telegram-discover',startInvite)).data.url,firstInvite.data.url);
  const invite=await call('telegram-discover',{...startInvite,regenerate:true});
  assert.equal(invite.status,200);
  assert.notEqual(invite.data.url,firstInvite.data.url);
  assert.equal((await call('telegram-discover',{action:'check',id:firstInvite.data.id})).status,409);
  assert.equal((await call('telegram-discover',{action:'check',id:invite.data.id})).data.found,false);
  telegramOnline=true;
  const code=new URL(invite.data.url).searchParams.get('start');
  updates.push({update_id:1,message:{text:'/start '+code,chat:{id:newChat,type:'private'},from:{id:newChat}}});
  const oldPair=await call('telegram-discover',{action:'start',mode:'responder',label:'Telegram only'});
  const oldCode=new URL(oldPair.data.url).searchParams.get('start');
  updates.push({update_id:2,message:{text:'/start '+oldCode,chat:{id:345678901,type:'private'}}});

  let roster;
  for (let attempt=0;attempt<25;attempt++) {
    roster=(await call('telegram-routing')).data.members;
    if (roster.some(person=>person.id===saved.data.member.id && person.telegram)) break;
    await setTimeout(180);
  }
  const member=roster.find(person=>person.id===saved.data.member.id);
  assert.equal(member.telegram?.label,'New member');
  assert.equal(member.email,'me•••@example.com');
  assert.equal((await call('telegram-discover',{action:'check',id:invite.data.id})).data.saved,true);
  assert.equal((await call('telegram-discover',{action:'check',id:oldPair.data.id})).data.saved,true);
  const changed=await call('team-members',{id:member.id,name:member.name,email:'new@example.com'});
  assert.equal(changed.data.confirmation.status,'accepted');
  assert.equal(changed.data.member.telegram.id,member.telegram.id);
  assert.deepEqual(confirmations[1].to,['new@example.com']);
  assert.equal((await call('team-members',{id:member.id,name:member.name,email:''})).data.confirmation,undefined);
  assert.equal(confirmations.length,2);

  const legacy=(await call('telegram-routing')).data.unlinkedEmail[0];
  emailOnline=false;
  const legacyChange=await call('team-members',{id:legacy.id,email:'updated@example.com'});
  assert.equal(legacyChange.data.confirmation.status,'unknown');
  assert.equal(legacyChange.data.member.email,'up•••@example.com');
  emailOnline=true;
  const retry=await call('team-members',{id:legacyChange.data.member.id,action:'confirm-email'});
  assert.equal(retry.data.confirmation.status,'accepted');
  assert.deepEqual(confirmations.at(-1).to,['updated@example.com']);
  assert.equal((await call('team-members',{id:member.id,action:'remove'})).status,409);
  assert.equal((await call('team-members',{id:member.id,action:'remove',confirm:true})).data.removed,true);
  const remaining=(await call('telegram-routing')).data;
  assert.ok(!remaining.members.some(person=>person.id===member.id));
  assert.ok(!remaining.people.some(person=>person.id===member.telegram.id));
  assert.equal((await call('telegram-discover',{action:'check',id:invite.data.id})).status,409);
  const status=(await call('status')).data;
  assert.equal(status.emailAutomatic,true);
  assert.equal(status.channels.email.recipients.length,2);
  assert.ok(!status.channels.email.recipients.some(person=>['me','ne','le'].some(prefix=>person.destination.startsWith(prefix))));
  assert.equal((await call('team-members',{id:linked.data.member.id,action:'remove',confirm:true})).data.removed,true);
  assert.ok(!(await call('telegram-routing')).data.people.some(person=>person.id==='default'));
  assert.equal((await call('status')).data.channels.telegram.recipients.length,0);
  assert.deepEqual(unexpected,[]);
});
