// Port of Calc.gs core to validate against real FACT_long.csv
const fs=require('fs');
const lines=fs.readFileSync('FACT_long.csv','utf8').trim().split('\n');
const hdr=lines[0].split(',');
const rows=lines.slice(1).map(l=>{
  // naive CSV (no embedded commas in our data except entity names? check). Use split but guard.
  const parts=l.split(',');
  const o={}; hdr.forEach((h,i)=>o[h]=parts[i]);
  o.calendar_year=Number(o.calendar_year);
  ['reported_value_chf','reported_growth_chf','cer_value','cer_growth'].forEach(k=>{o[k]=o[k]===''?null:Number(o[k]);});
  return o;
});
const QO=['Q1','Q2','Q3','Q4'];
function fiscalMap(cy,cq,sm){
  const aligned=(sm===1||sm===4||sm===7||sm===10);
  if(!aligned||sm===1) return {fiscalYear:cy,fiscalQ:QO.indexOf(cq)+1};
  const startQ={4:2,7:3,10:4}[sm]; const calQn=QO.indexOf(cq)+1; let fq=calQn-(startQ-1); let fy=cy;
  if(fq<=0) fq+=4; if(calQn<startQ) fy=cy-1; return {fiscalYear:fy,fiscalQ:fq};
}
function bv(r,b){return b==='CER'?r.cer_value:r.reported_value_chf;}
function bg(r,b){return b==='CER'?r.cer_growth:r.reported_growth_chf;}
function getQ(rows,ent,drill,fy,fIdx,sm){
  return rows.find(r=>r.period_type==='Quarter'&&r.entity===ent&&(r.drilldown_dim||'None')===(drill||'None')
    &&fiscalMap(r.calendar_year,r.quarter,sm).fiscalYear===fy&&fiscalMap(r.calendar_year,r.quarter,sm).fiscalQ===fIdx)||null;
}
function kpi(rows,sm,sel){
  const b=sel.basis,ent=sel.entity,drill=sel.drilldown||'None',fy=sel.fiscalYear;
  const get=(y,f)=>getQ(rows,ent,drill,y,f,sm);
  let value=null,growth=null,gsrc='computed',qoq=null,complete=true,present=0,status='actual';
  if(sel.periodType==='Quarter'){
    const cur=get(fy,sel.quarterIndex); value=cur?bv(cur,b):null; status=cur?cur.data_status:'missing';
    if(cur&&bg(cur,b)!=null){growth=bg(cur,b);gsrc='published';}
    const pi=sel.quarterIndex===1?4:sel.quarterIndex-1, py=sel.quarterIndex===1?fy-1:fy;
    const pr=get(py,pi),pv=pr?bv(pr,b):null; qoq=(value!=null&&pv!=null&&pv!==0)?value/pv-1:null;
  } else if(sel.periodType==='YTD'){
    let sum=0,miss=false; for(let f=1;f<=sel.quarterIndex;f++){const r=get(fy,f),v=r?bv(r,b):null; if(v==null)miss=true; else sum+=v;}
    value=miss?null:sum; let ps=0,pm=false; for(let f=1;f<=sel.quarterIndex;f++){const r=get(fy-1,f),v=r?bv(r,b):null; if(v==null)pm=true; else ps+=v;}
    const prior=pm?null:ps; growth=(value!=null&&prior!=null&&prior!==0)?value/prior-1:null;
  } else {
    let sum=0; present=0; for(let f=1;f<=4;f++){const r=get(fy,f),v=r?bv(r,b):null; if(v!=null){sum+=v;present++;}}
    complete=present===4; value=present>0?sum:null;
    const pub=rows.find(r=>r.period_type==='FullYear'&&r.entity===ent&&(r.drilldown_dim||'None')===drill&&r.calendar_year===fy&&bg(r,b)!=null);
    if(complete&&pub){growth=bg(pub,b);gsrc='published';}
    else{let ps=0,pq=0;for(let f=1;f<=4;f++){const r=get(fy-1,f),v=r?bv(r,b):null;if(v!=null){ps+=v;pq++;}}const prior=pq>0?ps:null;growth=(value!=null&&prior!=null&&prior!==0)?value/prior-1:null;}
  }
  return {value:value==null?null:Math.round(value*1000)/1000,growth,gsrc,qoq,complete,present,status};
}
const sm=1;
const T=[];
function chk(n,got,exp,tol){tol=tol||0.5;const p=got!=null&&Math.abs(got-exp)<=tol;T.push((p?'PASS ':'FAIL ')+n+`  got=${got} exp=${exp}`);}
chk('Group FY2025 CHF=61516',kpi(rows,sm,{basis:'CHF',periodType:'FullYear',fiscalYear:2025,quarterIndex:4,entity:'Group',drilldown:'None'}).value,61516);
chk('Pharma FY2025 CHF=47669',kpi(rows,sm,{basis:'CHF',periodType:'FullYear',fiscalYear:2025,quarterIndex:4,entity:'Pharmaceuticals Division',drilldown:'None'}).value,47669);
chk('Dia FY2025 CHF=13847',kpi(rows,sm,{basis:'CHF',periodType:'FullYear',fiscalYear:2025,quarterIndex:4,entity:'Diagnostics Division',drilldown:'None'}).value,13847);
chk('Group Q1-2025 CER=14567.226',kpi(rows,sm,{basis:'CER',periodType:'Quarter',fiscalYear:2025,quarterIndex:1,entity:'Group',drilldown:'None'}).value,14567.226,0.01);
const ytd=kpi(rows,sm,{basis:'CHF',periodType:'YTD',fiscalYear:2025,quarterIndex:3,entity:'Group',drilldown:'None'});
chk('Group YTD-Q3 2025 = 15440+15504+14918=45862',ytd.value,45862);
const qoq=kpi(rows,sm,{basis:'CHF',periodType:'Quarter',fiscalYear:2026,quarterIndex:1,entity:'Group',drilldown:'None'});
chk('Group Q1-2026 QoQ vs Q4-2025',qoq.qoq,14722/15654-1,0.001);
const fy26=kpi(rows,sm,{basis:'CHF',periodType:'FullYear',fiscalYear:2026,quarterIndex:4,entity:'Group',drilldown:'None'});
T.push((fy26.complete===false?'PASS ':'FAIL ')+'FY2026 incomplete (present='+fy26.present+')');
const g=kpi(rows,sm,{basis:'CHF',periodType:'FullYear',fiscalYear:2025,quarterIndex:4,entity:'Group',drilldown:'None'});
chk('Group FY2025 published growth=0.02',g.growth,0.02,0.005); T.push('INFO growthSource='+g.gsrc);
// fiscal Apr remap
const m=fiscalMap(2025,'Q2',4); T.push((m.fiscalYear===2025&&m.fiscalQ===1?'PASS ':'FAIL ')+'Apr FY: calQ2-2025->fiscalQ1-2025');
const m1=fiscalMap(2025,'Q1',4); T.push((m1.fiscalYear===2024&&m1.fiscalQ===4?'PASS ':'FAIL ')+'Apr FY: calQ1-2025->fiscalQ4-2024');
// YTD with Apr start: fiscal 2025 Q1..Q2 = calendar Q2-2025 + Q3-2025
const ytdApr=kpi(rows,4,{basis:'CHF',periodType:'YTD',fiscalYear:2025,quarterIndex:2,entity:'Group',drilldown:'None'});
const expApr=15504+14918; chk('Apr-FY YTD Q1-Q2 2025 = calQ2+calQ3 (30422)',ytdApr.value,expApr);
console.log(T.join('\n'));
