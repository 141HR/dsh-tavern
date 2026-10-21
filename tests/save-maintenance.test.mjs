import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from "node:fs/promises"
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createSaveMaintenance} from '../tavern-plugin/lib/domain/save-maintenance.js'

const big=n=>'x'.repeat(4096)+n
async function fixture(t,{idle=true,timers}={}){
 const root=await mkdtemp(join(tmpdir(),'save-maint-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const chats=createChatJournalStore({dataRoot:root,newConversations:true})
 const persistence=createChatPersistence({store:chats})
 const files=new Map(),pruned=[]
 const maintenance=createSaveMaintenance({
  chats,store:{readJson:async p=>structuredClone(files.get(p)),writeJson:async(p,v)=>files.set(p,structuredClone(v))},
  listChatIds:async()=>(await readdir(join(root,'chats'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name),
  requestLog:{prune:async id=>{pruned.push('requests:'+id)}},recallLog:{prune:async id=>{pruned.push('recalls:'+id)}},
  isIdle:async()=>idle,keepRecent:2,graceMs:0,logger:{log(){},warn(){}},everyRevisions:5,
  ...(timers?{setTimer:(fn,ms)=>{const id={fn,ms};timers.add(id);return id},clearTimer:id=>timers.delete(id)}:{})
 })
 const reopen=()=>createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 return {root,chats,persistence,maintenance,pruned,files,reopen}
}

test('分叉引用的父局版本保留；有任务进行时不整理', async t => {
 const {persistence,maintenance,reopen}=await fixture(t)
 await persistence.write({id:'p',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=8;i++)await persistence.patch('p',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 const parentAt3=await persistence.readRevision('p',3)
 await persistence.write({id:'c',mode:'story',forkedFrom:{chatId:'p',storageRevision:3},messages:[{role:'assistant',text:'fork'}]})
 await maintenance.sweep()
 assert.deepEqual(await reopen().readRevision('p',3),parentAt3)
 const busy=await fixture(t,{idle:false})
 await busy.persistence.write({id:'b',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 assert.equal((await busy.maintenance.maintainChat('b')).status,'busy')
})

test('结算后不立即整理：这一局安静一段时间、期间没有新的结算才整理', async t => {
 const timers=new Set()
 const {persistence,maintenance,files}=await fixture(t,{timers})
 await persistence.write({id:'q',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=8;i++)await persistence.patch('q',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 const compacted=()=>files.get('save-maintenance.json')?.compacted?.q
 maintenance.noteWrite('q',8)
 await new Promise(resolve=>setTimeout(resolve,10))
 assert.equal(compacted(),undefined,'结算后不立即整理')
 assert.equal(timers.size,1)
 assert.equal([...timers][0].ms,600000)
 // Another settlement restarts the quiet period.
 maintenance.noteWrite('q',9)
 assert.equal(timers.size,1)
 const [timer]=timers
 timers.delete(timer); timer.fn()
 for(let i=0;i<100&&compacted()===undefined;i++)await new Promise(resolve=>setTimeout(resolve,10))
 assert.equal(compacted(),9,'安静期满后整理')
})
