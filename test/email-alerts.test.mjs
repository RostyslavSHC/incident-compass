import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {createEmailOutbox} from '../email-alerts.mjs';

test('automatic email respects the toggle and deduplicates each incident event and recipient',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'aurelis-email-'));
  const path=pathToFileURL(join(folder,'.alert-email.local.json'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const recipients=['first@example.com','second@example.com'];
  const submissions=[];
  const mailer={
    path,
    config:async()=>({ready:true,recipients,settings:{}}),
    deliver:async (recipient,message)=>{
      submissions.push({recipient,message});
      return {status:'accepted'};
    },
  };
  const email=createEmailOutbox(mailer);
  const alert={key:'event-one',incident:'INC-121',title:'Checkout payments failing',service:'Payments API',level:'P1',reason:'critical'};
  await email.enqueue(alert);
  assert.equal((await email.status()).deliveries.length,0);
  await email.enable(true);
  await Promise.all([email.enqueue(alert),email.enqueue(alert)]);
  const restarted=createEmailOutbox(mailer);
  await restarted.step();
  await restarted.step();
  await restarted.enqueue({...alert,reason:'timeout'});
  await restarted.step();
  assert.deepEqual(submissions.map(item=>item.recipient),recipients);
  assert.match(submissions[0].message.subject,/P1 Critical \| Payments API \| INC-121/);
  assert.ok((await restarted.status()).deliveries.every(item=>item.status==='accepted' && !item.message));
  await restarted.enqueue({...alert,key:'event-two',level:'P2',reason:'timeout'});
  await restarted.enable(false);
  await restarted.step();
  assert.equal(submissions.length,2);
});

test('an interrupted SMTP submission is marked unknown without sending it again',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'aurelis-email-'));
  const path=pathToFileURL(join(folder,'.alert-email.local.json'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  await writeFile(path,JSON.stringify({enabled:true,entries:[{key:'example',recipient:'test@example.com',status:'sending',time:Date.now(),message:{text:'Test'}}]}));
  const email=createEmailOutbox({path,config:()=>assert.fail('No queued email'),deliver:()=>assert.fail('Would duplicate the email')});
  await email.step();
  assert.equal((await email.status()).deliveries[0].status,'unknown');
});
