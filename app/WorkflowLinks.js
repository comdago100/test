"use client";

export default function WorkflowLinks({order,orderId,active}) {
 const salesId=orderId||order?.order_id,wo=order?.wo_id;
 const links=[
  ['sales',salesId?`/sales/?order_id=${encodeURIComponent(salesId)}`:'/sales/',salesId?'연결 수주':'수주 관리'],
  ['orders',wo?`/orders/?wo_id=${encodeURIComponent(wo)}`:`/orders/?order_id=${encodeURIComponent(salesId||'')}`,'작업지시'],
  ['scanner',wo?`/scanner/?wo_id=${encodeURIComponent(wo)}`:'/scanner/','공정처리'],
  ['inspection',wo?`/inspections/?wo_id=${encodeURIComponent(wo)}`:salesId?`/inspections/?order_id=${encodeURIComponent(salesId)}`:'/inspections/','검사성적서'],
 ];
 return <div className="workflow-links" aria-label="업무 연결">{links.map(([key,href,label],i)=><span key={key}>{i>0&&<span aria-hidden="true">→ </span>}<a href={href} aria-current={active===key?'step':undefined}>{label}</a></span>)}{wo&&!salesId&&<small>기존 독립 작업지시 · 수주 미연결</small>}</div>;
}
