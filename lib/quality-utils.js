export const qualityKinds={hold_available:"불량 보류",hold_completed:"완료 양품에서 불량 분리",rework:"재작업 후 재투입",scrap:"폐기 확정",cancel:"불량 등록 취소",reversal:"처리 취소"};
export const defectReasons=["균열","기공·수축공","치수 불량","표면 불량","미충전","이물·개재물","기타"];
export function qualityStatus(defect) {
  if(Number(defect.held_qty)>0)return "보류 중";
  if(Number(defect.cancelled_qty)===Number(defect.quantity))return "등록 취소";
  return "처리 완료";
}
export function qualityCases(events) {
  const byId=new Map(events.map(event=>[event.event_id,event]));
  const cases=new Map(events.filter(event=>["hold_available","hold_completed"].includes(event.kind)).map(event=>[event.event_id,
    {...event,defect_id:event.event_id,source:event.kind==="hold_completed"?"completed":"available",reworked_qty:0,scrapped_qty:0,cancelled_qty:0,held_qty:Number(event.quantity)}]));
  for(const event of events){
    const defect=cases.get(event.defect_id);if(!defect)continue;
    const kind=event.reversal_of?byId.get(event.reversal_of)?.kind:event.kind;
    const field={rework:"reworked_qty",scrap:"scrapped_qty",cancel:"cancelled_qty"}[kind];
    if(field){defect[field]+=Number(event.quantity);defect.held_qty-=Number(event.quantity);}
  }
  return [...cases.values()];
}
export function qualityAdjustment(event,byId) {
  const kind=event.reversal_of?byId.get(event.reversal_of)?.kind:event.kind;
  if(kind==="hold_completed")return -Number(event.quantity);
  if(kind==="cancel"&&byId.get(event.defect_id)?.kind==="hold_completed")return Number(event.quantity);
  return 0;
}
