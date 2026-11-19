import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { needsOwnerApproval, requestActionApproval, consumeActionApproval, actionHash } from './toyota/hub/action-approval.mjs';

const output=[];
const check=(id,fun)=>{try{fun();output.push({id,status:'PASS'});console.log('PASS',id)}catch(err){output.push({id,status:'FAIL',error:err.message});console.error('FAIL',id,err)}};
const tmp=await mkdtemp(path.join(os.tmpdir(),'toyota-g10-'));
const db=new DatabaseSync(path.join(tmp,'test.sqlite'));
db.exec(`CREATE TABLE approvals (id TEXT PRIMARY KEY, ts TEXT, requester TEXT, kind TEXT, hash TEXT, payload TEXT, expires TEXT, state TEXT DEFAULT 'requested', decided_by TEXT, decided_ts TEXT, used_ts TEXT);`);
const Q={
 apReq:db.prepare('INSERT INTO approvals (id, ts, requester, kind, hash, payload, expires) VALUES (?,?,?,?,?,?,?)'),
 apUse:db.prepare("UPDATE approvals SET state='used', used_ts=? WHERE id=? AND requester=? AND hash=? AND state='granted' AND expires > ?"),
 apDecide:db.prepare("UPDATE approvals SET state=?, decided_by=?, decided_ts=? WHERE id=? AND state='requested' AND expires > ? AND requester<>?"),
 get:db.prepare('SELECT requester,kind,hash,payload,expires,state,decided_by FROM approvals WHERE id=?'),
};
const now=()=>new Date().toISOString();
try{
 check('G10-01 browser_open remains available for passive exploration',()=>assert.equal(needsOwnerApproval('browser_open',true,{url:'https://example.com'}),false));
 check('G10-02 navigation remains available',()=>assert.equal(needsOwnerApproval('browser_navigate',true,{url:'https://example.com'}),false));
 check('G10-03 benign hover remains available',()=>assert.equal(needsOwnerApproval('browser_act',true,{kind:'hover'}),false));
 check('G10-04 click requires owner',()=>assert.equal(needsOwnerApproval('browser_act',true,{kind:'click'}),true));
 check('G10-05 enter/submit requires owner',()=>assert.equal(needsOwnerApproval('browser_act',true,{kind:'type',submit:true}),true));
 check('G10-06 coordinate click requires owner',()=>assert.equal(needsOwnerApproval('browser_act',true,{kind:'clickCoords'}),true));
 check('G10-07 batch click requires owner',()=>assert.equal(needsOwnerApproval('browser_batch',true,{actions:[{kind:'hover'},{kind:'click'}]}),true));
 check('G10-08 safe batch does not require owner',()=>assert.equal(needsOwnerApproval('browser_batch',true,{actions:[{kind:'hover'},{kind:'wait'}]}),false));
 check('G10-09 malformed batch fails closed',()=>assert.equal(needsOwnerApproval('browser_batch',true,{}),true));
 check('G10-10 arbitrary evaluate requires owner',()=>assert.equal(needsOwnerApproval('browser_evaluate',true,{fn:'() => fetch("/delete")'}),true));
 check('G10-11 OpenClaw passthrough requires owner',()=>assert.equal(needsOwnerApproval('openclaw_tool',true,{tool:'browser'}),true));
 check('G10-12 downloads / uploads / dialogs require owner',()=>{for(const t of ['browser_upload','browser_download','browser_dialog','browser_close','browser_reset_session'])assert.equal(needsOwnerApproval(t,true,{}),true)});
 check('G10-13 hash canonicalizes argument order',()=>assert.equal(actionHash('agent','browser_act',{tabId:'T',kind:'click'}),actionHash('agent','browser_act',{kind:'click',tabId:'T'})));
 check('G10-14 hash binds identity, tool, parameters',()=>assert.notEqual(actionHash('agent','browser_act',{tabId:'T',kind:'click'}),actionHash('different','browser_act',{tabId:'T',kind:'click'})));
 const action={tabId:'T',kind:'click',ref:'e13'};
 const request=requestActionApproval(Q,'agent','browser_act',action);
 check('G10-15 create durable exact action request',()=>{const row=Q.get.get(request.approvalId);assert.equal(row.kind,'hub_action:browser_act');assert.equal(row.state,'requested');assert.deepEqual(JSON.parse(row.payload).args,action);assert.equal(row.hash,request.argsSha256)});
 check('G10-16 requester cannot self-grant',()=>assert.equal(Q.apDecide.run('granted','agent',now(),request.approvalId,now(),'agent').changes,0));
 check('G10-17 wrong approval ID is refused',()=>assert.throws(()=>consumeActionApproval(Q,'agent','browser_act',action,'x'.repeat(24)),/approval missing/));
 check('G10-18 owner may grant another principal only',()=>assert.equal(Q.apDecide.run('granted','owner',now(),request.approvalId,now(),'owner').changes,1));
 check('G10-19 grant cannot approve different argument',()=>assert.throws(()=>consumeActionApproval(Q,'agent','browser_act',{...action,ref:'e12'},request.approvalId),/different requester/));
 check('G10-20 grant cannot approve different tool',()=>assert.throws(()=>consumeActionApproval(Q,'agent','browser_evaluate',action,request.approvalId),/different requester/));
 check('G10-21 grant cannot approve another client',()=>assert.throws(()=>consumeActionApproval(Q,'claude','browser_act',action,request.approvalId),/different requester/));
 check('G10-22 one-shot approved action succeeds',()=>assert.equal(consumeActionApproval(Q,'agent','browser_act',action,request.approvalId),true));
 check('G10-23 consumed grant cannot be reused',()=>assert.throws(()=>consumeActionApproval(Q,'agent','browser_act',action,request.approvalId),/already used/));
 const expired=requestActionApproval(Q,'agent','browser_act',action);
 db.prepare("UPDATE approvals SET state='granted',expires='2020-01-01T00:00:00Z' WHERE id=?").run(expired.approvalId);
 check('G10-24 expired grant is refused',()=>assert.throws(()=>consumeActionApproval(Q,'agent','browser_act',action,expired.approvalId),/expired/));
 const src=await readFile(new URL('./toyota/hub/hub.mjs',import.meta.url),'utf8');
 check('G10-25 actual hub has gate before invoke',()=>{const gate=src.indexOf('consumeActionApproval(Q, owner');const invoke=src.indexOf('const res = await fn(actionArgs)');assert.ok(gate>0&&invoke>gate);});
 check('G10-26 actual hub includes per-tool approvalId input',()=>assert.match(src,/inputSchema: mutating && name !== "sms_send"/));
 check('G10-27 legacy SMS auto-approval disabled',()=>{assert.match(src,/const SMS_APPROVAL = "owner"/);assert.doesNotMatch(src,/approvalId = "__auto__"/);assert.doesNotMatch(src,/approvalId === "__auto__"/)});
 check('G10-28 same-requester approvals blocked in real DB SQL',()=>assert.match(src,/AND requester<>\?/));
 check('G10-29 navigation rejects javascript scheme at hub',()=>assert.match(src,/\["http:", "https:"\]\.includes\(u\.protocol\)/));
} finally {
 db.close();
 const report={runAt:new Date().toISOString(),scope:'local isolated Node 22 + SQLite + static hub wiring; no authentic MCP, Dell or customer sites',passed:output.filter(x=>x.status==='PASS').length,failed:output.filter(x=>x.status==='FAIL').length,results:output};
 await writeFile(new URL('./G10_RESULTS.json',import.meta.url),JSON.stringify(report,null,2));
 await rm(tmp,{recursive:true,force:true});
 console.log('SUMMARY',report.passed+'/'+output.length,report.failed?'FAIL':'PASS');
 if(report.failed)process.exitCode=1;
}
