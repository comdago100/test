export const productFields=[['po_no','PO번호',100],['po_line','PO 라인번호',60],['item_name','품명',200],['size','사이즈',120],['material','재질',120],['specification','적용 규격',300],['classification','요구 선급',120],['drawing_no','도면번호 / Rev.',120],['extra','기타 제품정보',2000]];
export function itemDetails(item){return {...(item?.product_details||{}),item_name:item?.item_name||'',material:item?.product_details?.material||item?.material||''};}
export function detailsText(row){return Object.values(row.product_details||{}).join(' ');}
export function reportJudgement(tests){const used=tests.filter(t=>t.judgement!=='na');if(!used.length||tests.some(t=>!t.name?.trim()||!t.standard?.trim()||!t.result?.trim()||!['pass','fail','na'].includes(t.judgement)||t.judgement==='na'&&!t.remark?.trim()))return 'pending';return used.some(t=>t.judgement==='fail')?'fail':'pass';}
export const judgementLabels={pending:'미판정',pass:'합격',fail:'불합격',na:'해당 없음'};
export const testGroups={visual:'외관',dimension:'치수',chemical:'화학성분',mechanical:'기계적 성질',ndt:'비파괴',other:'기타'};
export const blankTest=(group='dimension',name='')=>({group,name,standard:'',method:'',unit:'',result:'',judgement:'pending',remark:''});
export function inspectionTemplate(kind){return kind==='casting'?[blankTest('visual','표면 상태'),blankTest('dimension','주요 치수'),...['C','Si','Mn','P','S'].map(n=>({...blankTest('chemical',n),unit:'%'})),blankTest('mechanical','인장강도'),blankTest('mechanical','경도')]:[blankTest('visual','표면 상태'),blankTest('dimension','주요 치수')];}
