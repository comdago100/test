export const erpRpcs=["save_sales_order","delete_sales_order","create_sales_work_order","save_material_receipt","void_material_receipt","save_material_opening","save_item_profile","save_detailed_sales_order","save_detailed_work_order","create_detailed_sales_work_order","save_inspection_report","set_inspection_status"];
export function missingErp(error){return ["42P01","42703","PGRST202","PGRST204","PGRST205"].includes(error?.code);}
export function erpMessage(error){
 if(missingErp(error)&&/inspection|detailed|item_profile|product_details|profile_revision/.test(error?.message||''))return "제품정보·검사성적서 DB 설정이 필요합니다. product_inspection.sql을 적용하세요.";
 if(missingErp(error))return "수주·구매·재고 DB 설정이 필요합니다. light_erp.sql을 적용하세요.";
 if(error?.code==="23505")return "이미 등록된 번호입니다. 목록을 확인하세요.";
 if(error?.code==="42501")return "저장 권한을 확인하세요.";
 return error?.message||"연결 상태를 확인하세요.";
}
export function rowQuery(client,table,{order="created_at",ascending=false,filters=[],from=null,until=null,maxId=null}={}){
 let q=client.from(table).select("*");for(const [key,value] of filters)q=q.eq(key,value);
 if(from)q=q.gte("occurred_at",from);if(until)q=q.lt("occurred_at",until);
 if(maxId!=null)q=q.lte("movement_id",maxId);
 q=q.order(order,{ascending});
 const id={inventory_movements:"movement_id",sales_order_progress:"order_id",material_receipts:"receipt_id",inspection_reports:"report_id"}[table];
 return id&&order!==id?q.order(id,{ascending}):q;
}
export async function erpRows(client,table,options={}){
 const rows=[];
 for(let start=0;;start+=1000){const {data,error}=await rowQuery(client,table,options).range(start,start+999);if(error)throw error;rows.push(...(data||[]));if(!data||data.length<1000)return rows;}
}
export const qty=value=>Number(value||0).toLocaleString("ko-KR",{maximumFractionDigits:6});
export const money=value=>value==null?"미입력":Number(value).toLocaleString("ko-KR",{maximumFractionDigits:6})+"원";
export function receiptAmount(quantity,price){
 const decimal=value=>{const s=String(value);if(!/^\d+(\.\d*)?$/.test(s))return null;const [whole,fraction=""]=s.split(".");return {n:BigInt(whole+fraction),scale:fraction.length};};
 const a=decimal(quantity),b=decimal(price);if(!a||!b)return null;
 const divisor=10n**BigInt(a.scale+b.scale);return ((a.n*b.n*2n+divisor)/(2n*divisor)).toString();
}
export const koreanToday=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul"}).format(new Date());
