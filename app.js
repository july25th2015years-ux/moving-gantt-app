"use strict";
/** MOVE PLAN — shared storage with a local offline copy. */
const STORAGE_KEY = "move-plan-2026-v1";
const DAY_MS = 86400000;
const DEFAULT_MOVE_DATE = "2026-12-19";
const VALID_STATUSES = new Set(["todo", "doing", "done"]);
const VALID_CATEGORIES = new Set(["契約・手続き", "業者・運搬", "荷造り・片付け", "当日・退去", "その他"]);
const SEED_TASKS = [
  ["物件・ペット可・学区などの条件確認", "2026-11-12", "2026-11-16", "todo", "契約・手続き", "入居前にペット条件や通学条件を確認"],
  ["新居の申し込み・入居審査", "2026-11-13", "2026-11-20", "todo", "契約・手続き", "まだ申し込み前。審査完了日を確認"],
  ["賃料発生日・初期費用を確定", "2026-11-14", "2026-11-20", "todo", "契約・手続き", "見積の日付は仮。新居の管理会社に確認"],
  ["仲介手数料・不要なオプション確認", "2026-11-15", "2026-11-20", "todo", "契約・手続き", "仲介手数料0.55か月分への交渉。任意費用を確認"],
  ["火災保険の比較・契約", "2026-11-17", "2026-11-24", "todo", "契約・手続き", "自分で選べる条件。補償開始日は賃貸契約に合わせる"],
  ["新居の契約締結・鍵受取日確認", "2026-11-20", "2026-11-25", "todo", "契約・手続き", "ここが決まってから旧居の解約通知を確定する"],
  ["旧居へ解約予告を提出", "2026-11-20", "2026-11-21", "todo", "契約・手続き", "解約予告1か月前。旧居は日割り精算。新居契約を確認してから提出"],
  ["大型家電・家具の採寸とリスト作成", "2026-11-16", "2026-11-23", "todo", "業者・運搬", "冷蔵庫・洗濯機・ベッドなどの寸法と搬入経路を確認"],
  ["大型家具のみ引越し業者へ見積・予約", "2026-11-19", "2026-11-28", "todo", "業者・運搬", "自力で運ぶ荷物と業者へ依頼する荷物を分ける"],
  ["不用品の整理・処分", "2026-11-25", "2026-12-10", "todo", "荷造り・片付け", "不要品の処分と譲渡・売却"],
  ["段ボール・梱包材の準備", "2026-11-27", "2026-12-04", "todo", "荷造り・片付け", "壊れ物・衣類・日用品ごとに分類"],
  ["荷造り・持参する荷物の搬出準備", "2026-12-01", "2026-12-17", "todo", "荷造り・片付け", "使わない物から順に梱包"],
  ["電気・ガス・水道などの開始・停止手続き", "2026-12-02", "2026-12-16", "todo", "契約・手続き", "ガス開栓は立会いが必要か確認"],
  ["郵便転送・住所変更の準備", "2026-12-07", "2026-12-17", "todo", "契約・手続き", "郵便物の転送、学校関連の連絡を確認"],
  ["新居の鍵受領・掃除", "2026-12-17", "2026-12-18", "todo", "当日・退去", "日付は仮。家賃発生日と鍵受領日に合わせて変更"],
  ["自分たちで運ぶ荷物の搬入", "2026-12-18", "2026-12-20", "todo", "当日・退去", "小さな荷物・日用品など"],
  ["大型家電・家具の搬入", "2026-12-19", "2026-12-19", "todo", "当日・退去", "希望の搬入日。予約できた日付に変更"],
  ["旧居の清掃・最終チェック", "2026-12-20", "2026-12-21", "todo", "当日・退去", "忘れ物・公共料金メーター・返却物を確認"],
  ["旧居の鍵返却・退去", "2026-12-21", "2026-12-21", "todo", "当日・退去", "退去日は仮。解約日との整合性を確認"],
  ["転居届・住所変更・学校等の手続き", "2026-12-22", "2026-12-31", "todo", "契約・手続き", "引っ越し後は必要な行政・金融・学校関連の手続きを確認"]
].map((row, i) => ({id: `seed-${i + 1}`, title:row[0], start:row[1], end:row[2], status:row[3], category:row[4], notes:row[5], progress:0}));

const $ = id => document.getElementById(id);
let tasks = loadTasks();
let filter = "all";
let timelineStart;
let timelineEnd;
let cellWidth = 36;
let toastTimer;
let moveDate = loadMoveDate();
const SYNC_URL = "https://moving-plan-sync-yoshida.july25th2015years.chatgpt.site/api/plans/moving-2026-shared-7c5f48b9a62e49b4";
const PENDING_KEY=STORAGE_KEY+"-pending";
let localSnapshot={moveDate,tasks:structuredClone(tasks)};
let pending=[];
try{const stored=JSON.parse(localStorage.getItem(PENDING_KEY));if(Array.isArray(stored))pending=stored;}catch{}
let syncBusy=false,sharedReady=false,editorOriginal=null;
function setSaveNotice(text){$("saveNotice").textContent=text;}
function persistPending(){try{localStorage.setItem(PENDING_KEY,JSON.stringify(pending));}catch{setSaveNotice("端末に保存できません。バックアップしてください");}}
function planDiff(before,after){
 const change={},old=new Map(before.tasks.map(t=>[t.id,t]));
 const patches=[];
 for(const t of after.tasks){const prev=old.get(t.id);if(!prev){patches.push({id:t.id,add:t});continue;}const fields={};for(const key of ["title","start","end","status","category","notes","progress"])if(t[key]!==prev[key])fields[key]=t[key];if(Object.keys(fields).length)patches.push({id:t.id,fields});}
 if(patches.length)change.patches=patches;
 const ids=new Set(after.tasks.map(t=>t.id));const deleted=before.tasks.filter(t=>!ids.has(t.id)).map(t=>t.id);if(deleted.length)change.deleted=deleted;
 const order=after.tasks.map(t=>t.id);if(JSON.stringify(order)!==JSON.stringify(before.tasks.map(t=>t.id)))change.order=order;
 if(before.moveDate!==after.moveDate)change.moveDate=after.moveDate;
 return change;
}
function applyChanges(state,changes){
 const result=structuredClone(state);
 for(const c of changes){
  if(c.deleted)result.tasks=result.tasks.filter(t=>!c.deleted.includes(t.id));
  for(const p of c.patches||[]){const t=result.tasks.find(t=>t.id===p.id);if(p.add){if(!t)result.tasks.push(structuredClone(p.add));}else if(t)Object.assign(t,p.fields);}
  if(c.order){const rank=new Map(c.order.map((id,i)=>[id,i]));result.tasks.sort((a,b)=>(rank.get(a.id)??10000)-(rank.get(b.id)??10000));}
  if(c.moveDate)result.moveDate=c.moveDate;
 }
 return result;
}
async function requestShared(method="GET",state,etag){
 const headers={};if(state){headers["Content-Type"]="application/json";headers[etag==='"empty"'?"If-None-Match":"If-Match"]=etag==='"empty"'?"*":etag;}
 return fetch(SYNC_URL,{method,headers,body:state?JSON.stringify(state):undefined,cache:"no-store",signal:AbortSignal.timeout(12000)});
}
function acceptShared(state){
 const next=applyChanges(state,pending);tasks=next.tasks.map(normalizeTask);moveDate=next.moveDate;
 localSnapshot={moveDate,tasks:structuredClone(tasks)};cacheState();render();
}
async function synchronize(){
 if(syncBusy||document.body.classList.contains("is-sorting")||document.querySelector(".gantt-bar.dragging"))return;
 syncBusy=true;
 try{
  for(let attempt=0;attempt<4;attempt++){
   const response=await requestShared();if(!response.ok)throw new Error("read");
   const etag=response.headers.get("ETag");if(!etag)throw new Error("etag");
   const payload=await response.json();let remote=payload.state;
   if(remote){if(!Array.isArray(remote.tasks)||!validDate(remote.moveDate))throw new Error("state");remote={moveDate:remote.moveDate,tasks:remote.tasks.map(normalizeTask)};}
   const batch=pending.slice();
   if(!remote||batch.length){
    const next=remote?applyChanges(remote,batch):{moveDate,tasks:structuredClone(tasks)};
    const saved=await requestShared("PUT",next,etag);
    if(saved.status===412)continue;
    if(!saved.ok)throw new Error("write");
    pending.splice(0,batch.length);persistPending();remote=next;
   }
   if(!sharedReady){try{if(!localStorage.getItem(STORAGE_KEY+"-before-sharing"))localStorage.setItem(STORAGE_KEY+"-before-sharing",JSON.stringify(localSnapshot));}catch{}sharedReady=true;}
   acceptShared(remote);setSaveNotice(pending.length?"共有へ保存中…":"共有に保存済み · 自動同期 ON");
   return;
  }
  throw new Error("conflict");
 }catch(err){setSaveNotice(pending.length?"未送信の変更あり · 再接続後に再送":"共有に接続できません · 再試行します");}
 finally{syncBusy=false;}
}
function restoreLocalPlan(){
 let data;try{data=JSON.parse(localStorage.getItem(STORAGE_KEY+"-before-sharing"));}catch{}
 if(!data||!Array.isArray(data.tasks)){showToast("移行前の予定はありません");return;}
 if(!sharedReady){showToast("共有に接続してからお試しください");return;}
 if(!confirm("共有中の予定を、この端末の移行前の予定で置き換えますか？相手の画面にも反映されます。"))return;
 tasks=data.tasks.map(normalizeTask);moveDate=data.moveDate;saveTasks();render();
}

function isoToDay(iso) { const [y,m,d] = iso.split("-").map(Number); return Math.round(Date.UTC(y,m-1,d)/DAY_MS); }
function dayToIso(day) { return new Date(day*DAY_MS).toISOString().slice(0,10); }
function validDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayToIso(isoToDay(s)) === s; }
function localToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function formatDate(iso) { const [y,m,d]=iso.split("-").map(Number); return `${m}/${d}`; }
function dateLabel(iso) { const [y,m,d]=iso.split("-").map(Number); return `${m}月${d}日`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function normalizeTask(obj, i) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error(`${i+1}件目のタスクが不正です。`);
  const title=String(obj.title??"").trim().slice(0,100);
  if (!title || !validDate(obj.start) || !validDate(obj.end) || isoToDay(obj.start)>isoToDay(obj.end)) throw new Error(`${i+1}件目のタスク名または日付が不正です。`);
  const id = typeof obj.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(obj.id) ? obj.id : makeId();
  const status = (obj.status === "hold" || !VALID_STATUSES.has(obj.status)) ? "todo" : obj.status;
  const progress = status === "done" ? 100 : Math.max(0, Math.min(100, Number(obj.progress) || 0));
  return {id,title,start:obj.start,end:obj.end,status,category:VALID_CATEGORIES.has(obj.category)?obj.category:"その他",notes:String(obj.notes??"").slice(0,1000),progress};
}
function makeId() { return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`; }
function loadTasks() { try { const data=JSON.parse(localStorage.getItem(STORAGE_KEY)); if (data && Array.isArray(data.tasks) && data.tasks.length<=500) { const t=data.tasks.map(normalizeTask); if(new Set(t.map(x=>x.id)).size === t.length) return t; } } catch(err) { console.warn("保存済みデータは読み込めませんでした:",err); } return SEED_TASKS.map(x=>({...x})); }
function loadMoveDate(){try{const data=JSON.parse(localStorage.getItem(STORAGE_KEY));if(data&&validDate(data.moveDate))return data.moveDate;}catch(e){}return DEFAULT_MOVE_DATE;}
function cacheState(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,moveDate,tasks}));return true;}catch{return false;}}
function saveTasks(){
  const next={moveDate,tasks:structuredClone(tasks)};
  const change=planDiff(localSnapshot,next);
  if(Object.keys(change).length)pending.push(change);
  localSnapshot=next;
  cacheState();persistPending();setSaveNotice("共有へ保存中…");void synchronize();
}
function showToast(message){const t=$("toast");t.textContent=message;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2500);}
function visibleTasks(){return tasks.filter(t=>filter==="all" || (filter==="open"&&t.status!=="done") || (filter==="done"&&t.status==="done"));}
function statusText(status){return ({todo:"未着手",doing:"進行中",done:"完了"})[status]||"未着手";}
function calculateBounds(){const dates=tasks.flatMap(t=>[isoToDay(t.start),isoToDay(t.end)]);dates.push(isoToDay(moveDate),isoToDay(localToday()));let min=Math.min(...dates,isoToDay("2026-11-12"))-3;let max=Math.max(...dates,isoToDay("2026-12-31"))+4;if(max-min>730){min=isoToDay(localToday())-30;max=isoToDay(localToday())+400;}timelineStart=min;timelineEnd=max;}
function renderSummary(){const done=tasks.filter(t=>t.status==="done").length;const todo=tasks.filter(t=>t.status==="todo").length;const pct=tasks.length?Math.round(tasks.reduce((s,t)=>s+t.progress,0)/tasks.length):0;$("moveDate").textContent=dateLabel(moveDate);$("moveDateInput").value=moveDate;$("progressValue").textContent=pct;$("progressFill").style.width=pct+"%";$("doneValue").textContent=done;$("totalValue").textContent=tasks.length;if($("todoValue"))$("todoValue").textContent=todo;const priority=tasks.filter(t=>t.status!=="done").sort((a,b)=>a.start.localeCompare(b.start)).slice(0,4);$("priorityList").innerHTML=priority.length?priority.map(t=>`<div class="priority-item"><button type="button" data-edit="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button><time>${formatDate(t.end)} まで</time></div>`).join(""):'<div class="priority-item">未完了のタスクはありません。</div>';$("priorityList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEditor(b.dataset.edit)));}
function renderChart({keepScroll=true}={}){
  const scroller=$("ganttBoard");const oldScrollX=keepScroll?scroller.scrollLeft:0;const oldScrollY=keepScroll?scroller.scrollTop:0;
  cellWidth=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell")) || 36;
  calculateBounds();const n=timelineEnd-timelineStart+1;$("timelineContent").style.width=n*cellWidth+"px";
  const list=visibleTasks();$("taskCount").textContent=`${list.length}件`;
  const months=[];let monthKey="",monthCount=0,monthLabel="";
  const dayCells=[];for(let i=0;i<n;i++){
    const day=timelineStart+i,dt=new Date(day*DAY_MS),y=dt.getUTCFullYear(),m=dt.getUTCMonth()+1,d=dt.getUTCDate(),wk=dt.getUTCDay(),key=`${y}-${m}`;
    if(monthKey && key!==monthKey){months.push(`<div class="month-cell" style="width:${monthCount*cellWidth}px">${monthLabel}</div>`);monthCount=0;}
    monthKey=key;monthLabel=`${y}年 ${m}月`;monthCount++;
    const iso=dayToIso(day);dayCells.push(`<div class="day-cell ${wk===0||wk===6?"weekend":""} ${iso===localToday()?"today":""}" title="${iso}"><span>${d}</span><small>${"日月火水木金土"[wk]}</small></div>`);
  }months.push(`<div class="month-cell" style="width:${monthCount*cellWidth}px">${monthLabel}</div>`);
  $("monthHeader").innerHTML=months.join("");$("dayHeader").innerHTML=dayCells.join("");
  $("taskSidebarRows").innerHTML=list.map((t,i)=>{
    const st=(t.status==="done"||t.progress>=100)?"done":(t.status==="doing"||t.progress>0)?"doing":"todo";
    return `<div class="task-item" data-id="${escapeHtml(t.id)}" data-index="${i}"><span class="drag-handle" role="button" tabindex="0" title="ドラッグまたは矢印キーで並び替え" aria-label="並び替え">⠿</span><span class="task-index">${String(i+1).padStart(2,"0")}</span><button class="task-name" type="button" data-edit="${escapeHtml(t.id)}" title="${escapeHtml(t.title)}"><strong>${escapeHtml(t.title)}</strong><div class="task-meta"><span class="task-status-badge ${st}">${statusText(st)}</span><small>${formatDate(t.start)}–${formatDate(t.end)} · ${escapeHtml(t.category)}</small></div></button></div>`;
  }).join("");
  $("taskSidebarRows").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEditor(b.dataset.edit)));
  attachTaskDragEvents($("taskSidebarRows"));
  const todayX=(isoToDay(localToday())-timelineStart)*cellWidth+(cellWidth/2);
  $("timelineRows").innerHTML=`<div class="today-line" style="left:${todayX}px"></div>`+list.map(t=>{
    const st=(t.status==="done"||t.progress>=100)?"done":(t.status==="doing"||t.progress>0)?"doing":"todo";
    const left=(isoToDay(t.start)-timelineStart)*cellWidth+4,width=(isoToDay(t.end)-isoToDay(t.start)+1)*cellWidth-8;
    return `<div class="timeline-row"><div class="gantt-bar ${st} ${width<95?"short":""}" role="button" tabindex="0" aria-label="${escapeHtml(t.title)}: ${escapeHtml(t.start)}から${escapeHtml(t.end)}。日付変更または編集" data-id="${escapeHtml(t.id)}" style="left:${left}px;width:${width}px"><span class="bar-handle" data-edge="left" title="開始日を変更"></span><span class="bar-text">${escapeHtml(t.title)}</span><span class="bar-handle" data-edge="right" title="終了日を変更"></span></div></div>`;
  }).join("");
  $("timelineRows").querySelectorAll(".gantt-bar").forEach(attachBarEvents);
  $("emptyState").hidden=list.length!==0;
  scroller.scrollLeft=oldScrollX;scroller.scrollTop=oldScrollY;
}
function attachTaskDragEvents(container){
  const items=Array.from(container.querySelectorAll(".task-item"));
  items.forEach(item=>{
    const handle=item.querySelector(".drag-handle");
    let drag=null;
    handle.addEventListener("pointerdown",e=>{
      if(e.button!==0)return;
      const allItems=Array.from(container.querySelectorAll(".task-item"));
      const fromIndex=allItems.indexOf(item);
      drag={pointerId:e.pointerId,pointerType:e.pointerType,startY:e.clientY,item,id:item.dataset.id,fromIndex,allItems,hasMoved:false,targetInfo:null};
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove",e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const deltaY=e.clientY-drag.startY;
      const threshold=drag.pointerType==="touch"?8:4;
      if(!drag.hasMoved&&Math.abs(deltaY)>threshold){
        drag.hasMoved=true;
        drag.item.classList.add("is-dragging");
        document.body.classList.add("is-sorting");
      }
      if(!drag.hasMoved)return;
      drag.item.style.transform=`translateY(${deltaY}px)`;
      drag.allItems.forEach(el=>el.classList.remove("drop-target-above","drop-target-below"));
      
      // ドロップ先の行と位置を判定
      let found=null;
      for(let i=0;i<drag.allItems.length;i++){
        const el=drag.allItems[i];
        if(el===drag.item)continue;
        const r=el.getBoundingClientRect();
        if(e.clientY>=r.top&&e.clientY<=r.bottom){
          const pos=e.clientY<r.top+r.height/2?"above":"below";
          found={el,id:el.dataset.id,pos};
          break;
        }
      }
      if(!found){
        const first=drag.allItems[0],last=drag.allItems[drag.allItems.length-1];
        if(first&&first!==drag.item&&e.clientY<first.getBoundingClientRect().top){
          found={el:first,id:first.dataset.id,pos:"above"};
        }else if(last&&last!==drag.item&&e.clientY>last.getBoundingClientRect().bottom){
          found={el:last,id:last.dataset.id,pos:"below"};
        }
      }
      if(found){
        found.el.classList.add(found.pos==="above"?"drop-target-above":"drop-target-below");
        drag.targetInfo=found;
      }
    });
    const finish=e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const {hasMoved,id,targetInfo,allItems}=drag;
      drag.item.style.transform="";
      drag.item.classList.remove("is-dragging");
      document.body.classList.remove("is-sorting");
      allItems.forEach(el=>el.classList.remove("drop-target-above","drop-target-below"));
      drag=null;
      if(hasMoved&&targetInfo&&targetInfo.id!==id){
        reorderTasks(id,targetInfo.id,targetInfo.pos);
      }
    };
    handle.addEventListener("pointerup",finish);
    handle.addEventListener("pointercancel",finish);
    handle.addEventListener("keydown",e=>{
      if(e.key==="ArrowUp"||e.key==="ArrowDown"){
        e.preventDefault();
        const allItems=Array.from(container.querySelectorAll(".task-item"));
        const idx=allItems.indexOf(item);
        const targetIdx=e.key==="ArrowUp"?idx-1:idx+1;
        if(targetIdx>=0&&targetIdx<allItems.length){
          const movingId=item.dataset.id;
          const targetId=allItems[targetIdx].dataset.id;
          reorderTasks(movingId,targetId,e.key==="ArrowUp"?"above":"below");
          setTimeout(()=>{
            container.querySelector(`.task-item[data-id="${movingId}"] .drag-handle`)?.focus();
          },50);
        }
      }
    });
  });
}
function reorderTasks(movingId,targetId,position){
  if(movingId===targetId)return;
  const actualFrom=tasks.findIndex(t=>t.id===movingId);
  const actualTarget=tasks.findIndex(t=>t.id===targetId);
  if(actualFrom===-1||actualTarget===-1)return;
  const [removed]=tasks.splice(actualFrom,1);
  let newIndex=tasks.findIndex(t=>t.id===targetId);
  if(position==="below")newIndex+=1;
  tasks.splice(newIndex,0,removed);
  saveTasks();
  render();
  showToast("タスクの並び順を変更しました");
}
function attachBarEvents(bar){
  let drag=null,suppress=false,suppressTimer=null;
  bar.addEventListener("pointerdown",e=>{
    if(e.button!==0)return; const t=tasks.find(x=>x.id===bar.dataset.id);if(!t)return;
    const mode=e.target?.dataset?.edge||"move";
    drag={pointerId:e.pointerId,pointerType:e.pointerType,clientX:e.clientX,initialStart:isoToDay(t.start),initialEnd:isoToDay(t.end),mode,shift:0};
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener("pointermove",e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    const threshold=drag.pointerType==="touch"?10:4;
    const shift=Math.round((e.clientX-drag.clientX)/cellWidth);drag.shift=shift;
    if(Math.abs(e.clientX-drag.clientX)>threshold){suppress=true;bar.classList.add("dragging");}
    let from=drag.initialStart,to=drag.initialEnd;
    if(drag.mode==="move"){from+=shift;to+=shift;}
    if(drag.mode==="left")from=Math.min(drag.initialStart+shift,to);
    if(drag.mode==="right")to=Math.max(drag.initialEnd+shift,from);
    bar.style.left=((from-timelineStart)*cellWidth+4)+"px";bar.style.width=((to-from+1)*cellWidth-8)+"px";
  });
  const finish=e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    const {shift,mode,initialStart,initialEnd}=drag;drag=null;bar.classList.remove("dragging");
    if(shift!==0){
      const t=tasks.find(x=>x.id===bar.dataset.id);if(t){
        let from=initialStart,to=initialEnd;if(mode==="move"){from+=shift;to+=shift;}
        if(mode==="left")from=Math.min(initialStart+shift,to);if(mode==="right")to=Math.max(initialEnd+shift,from);
        t.start=dayToIso(from);t.end=dayToIso(to);saveTasks();render();showToast("日程を変更しました");return;
      }
    }
    bar.style.left=((initialStart-timelineStart)*cellWidth+4)+"px";bar.style.width=((initialEnd-initialStart+1)*cellWidth-8)+"px";
    if(suppress){clearTimeout(suppressTimer);suppressTimer=setTimeout(()=>{suppress=false;},200);}
  };
  bar.addEventListener("pointerup",finish);
  bar.addEventListener("pointercancel",e=>{drag=null;bar.classList.remove("dragging");suppress=false;renderChart();});
  bar.addEventListener("click",e=>{if(suppress){suppress=false;return;}openEditor(bar.dataset.id);});
  bar.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openEditor(bar.dataset.id);}});
}
function scrollToToday(){const x=(isoToDay(localToday())-timelineStart)*cellWidth;$("ganttBoard").scrollTo({left:Math.max(0,x-180),behavior:"smooth"});}
function render(options){renderSummary();renderChart(options);}
function setProgressValue(val){
  const num=Number(val)||0;
  let target=0;
  if(num>=100)target=100;
  else if(num>0)target=50;
  $("taskProgress").value=target;
  document.querySelectorAll(".segment-btn").forEach(btn=>{
    btn.classList.toggle("active",Number(btn.dataset.progress)===target);
  });
}
function openEditor(id){const task=tasks.find(t=>t.id===id);editorOriginal=task?structuredClone(task):null;$("taskId").value=task?task.id:"";$("dialogTitle").textContent=task?"タスクを編集":"タスクを追加";$("taskTitle").value=task?.title||"";$("taskStart").value=task?.start||localToday();$("taskEnd").value=task?.end||localToday();$("taskStatus").value=(task?.status==="hold"||!VALID_STATUSES.has(task?.status))?"todo":(task?.status||"todo");$("taskCategory").value=task?.category||"その他";setProgressValue(task?task.progress:0);$("taskNotes").value=task?.notes||"";$("formError").hidden=true;$("deleteButton").hidden=!task;$("taskDialog").showModal();$("taskTitle").focus();}
function closeEditor(){$("taskDialog").close();}
function saveEditor(e){e.preventDefault();const id=$("taskId").value,title=$("taskTitle").value.trim(),start=$("taskStart").value,end=$("taskEnd").value,status=$("taskStatus").value,category=$("taskCategory").value;const error=$("formError");if(!title||!validDate(start)||!validDate(end)||isoToDay(start)>isoToDay(end)){error.textContent="タスク名、開始日、終了日を正しく入力してください。";error.hidden=false;return;}
  const old=tasks.find(t=>t.id===id);const task={id:old?.id||makeId(),title:title.slice(0,100),start,end,status,category,progress:status==="done"?100:Number($("taskProgress").value),notes:$("taskNotes").value.slice(0,1000)};
  if(old){for(const key of ["title","start","end","status","category","progress","notes"])if(!editorOriginal||task[key]!==editorOriginal[key])old[key]=task[key];if(isoToDay(old.start)>isoToDay(old.end)){Object.assign(old,editorOriginal);error.textContent="相手の日程変更と重なりました。開き直して日付を確認してください。";error.hidden=false;return;}}else if(id&&editorOriginal){error.textContent="このタスクは相手が削除しました。閉じて一覧をご確認ください。";error.hidden=false;return;}else tasks.push(task);
  // A task named exactly "大型家電・家具の搬入" updates the move-day display.
  if(task.id==="seed-17")moveDate=(old||task).start;
  closeEditor();saveTasks();render();showToast(old?"変更を受け付けました":"タスクを追加しました");
}
function downloadJson(){const data={version:1,exportedAt:new Date().toISOString(),moveDate,tasks};const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`move-plan-backup-${localToday()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);showToast("バックアップファイルを保存しました");}
async function importJson(file){if(!file)return;try{if(file.size>2_000_000)throw new Error("2MB以内のJSONファイルを選んでください。");const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.tasks)||data.tasks.length>500||data.tasks.length<0)throw new Error("タスクを含む正しいJSONファイルではありません。");const next=data.tasks.map(normalizeTask);if(new Set(next.map(t=>t.id)).size!==next.length)throw new Error("タスクIDが重複しています。");if(!confirm(`共有している全員の予定をバックアップファイルの${next.length}件で置き換えますか？`))return;tasks=next;moveDate=validDate(data.moveDate)?data.moveDate:DEFAULT_MOVE_DATE;saveTasks();render({keepScroll:false});showToast("バックアップを読み込みました");}catch(err){alert(`読み込みに失敗しました：${err.message}`);}finally{$("importFile").value="";}}
function init(){
  let needClean=false;
  tasks.forEach(t=>{if(t.status==="hold"||!VALID_STATUSES.has(t.status)){t.status="todo";needClean=true;}});
  if(needClean)saveTasks();
  $("restoreLocalButton").addEventListener("click",restoreLocalPlan);
  window.addEventListener("online",()=>void synchronize());
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void synchronize();});
  setInterval(()=>{if(!document.hidden)void synchronize();},3000);
  void synchronize();
  $("moveDateInput").addEventListener("change",e=>{if(!validDate(e.target.value))return;moveDate=e.target.value;saveTasks();render();showToast("引っ越し予定日を変更しました");});
  $("addButton").addEventListener("click",()=>openEditor(null));$("todayButton").addEventListener("click",scrollToToday);$("filterSelect").addEventListener("change",e=>{filter=e.target.value;renderChart();});$("exportButton").addEventListener("click",downloadJson);$("importButton").addEventListener("click",()=>$("importFile").click());$("importFile").addEventListener("change",e=>importJson(e.target.files[0]));$("resetButton").addEventListener("click",()=>{if(!confirm("共有している全員の予定をすべて消して初期予定に戻しますか？ 先にバックアップすることをおすすめします。"))return;tasks=SEED_TASKS.map(t=>({...t}));moveDate=DEFAULT_MOVE_DATE;saveTasks();render({keepScroll:false});showToast("初期予定に戻しました");});
  $("closeDialog").addEventListener("click",closeEditor);$("cancelButton").addEventListener("click",closeEditor);$("taskDialog").addEventListener("click",e=>{if(e.target===$("taskDialog"))closeEditor();});$("taskForm").addEventListener("submit",saveEditor);
  document.querySelectorAll(".segment-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const target=Number(btn.dataset.progress);
      setProgressValue(target);
      if(target===100){$("taskStatus").value="done";}
      else if(target===50 && $("taskStatus").value==="todo"){$("taskStatus").value="doing";}
      else if(target===0 && $("taskStatus").value==="done"){$("taskStatus").value="todo";}
    });
  });
  $("taskStatus").addEventListener("change",e=>{
    if(e.target.value==="done")setProgressValue(100);
    else if(e.target.value==="doing")setProgressValue(50);
    else if(e.target.value==="todo")setProgressValue(0);
  });
  $("deleteButton").addEventListener("click",()=>{const id=$("taskId").value;if(!id)return;const t=tasks.find(x=>x.id===id);if(t&&!confirm(`「${t.title}」を削除しますか？`))return;tasks=tasks.filter(x=>x.id!==id);closeEditor();saveTasks();render();showToast("タスクを削除しました");});
  let resizeTimer;window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>renderChart(),100);});
  render({keepScroll:false});const initialX=(isoToDay("2026-11-12")-timelineStart)*cellWidth;$("ganttBoard").scrollLeft=Math.max(0,initialX-10);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
