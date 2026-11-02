import test from "node:test";
import assert from "node:assert/strict";
import { emptyClient, clientForm, clientPayload, clientMatches, formatBusinessNumber, validateClient } from "../lib/client-utils.js";
import { buildMasterSheets } from "../lib/production-export.js";

test("only client code and name are mandatory and optional contact data stays optional",()=>{
  const form={...emptyClient(),client_code:"001",client_name:"제조 거래처"};
  assert.equal(validateClient(form),"");
  assert.equal(validateClient({...form,business_number:"123-45-67890",postal_code:"00123",email:"buyer+orders@example.com"}),"");
  for(const patch of [{client_code:""},{client_name:""},{client_code:"A B"},{business_number:"123"},{postal_code:"1234"},
    {email:"invalid"},{tax_email:"a@b"},{client_type:"invalid"},{is_active:"false"},{phone:"x".repeat(51)}])
    assert.notEqual(validateClient({...form,...patch}),"");
  assert.equal(clientPayload({...form,business_number:" 123-45-67890 "}).business_number,"1234567890");
  assert.equal(formatBusinessNumber("0012345678"),"001-23-45678");
});
test("legacy contacts are searchable and inactive records retain their status",()=>{
  const row={client_code:"001",client_name:"주조 업체",business_number:"1234567890",
    contact_name:"김담당",contact_phone:"010-1234-5678",contact_info:"기존 연락처",is_active:false};
  assert.equal(clientForm(row).is_active,false);
  assert.equal(clientForm(row).phone,"");
  for(const query of ["김담당","123-45-67890","01012345678","기존 연락처"]) assert.equal(clientMatches(row,query),true);
  assert.equal(clientMatches(row,"","all","active"),false);
  assert.equal(clientMatches(row,"","customer","inactive"),true);
});
test("expanded client Excel preserves legacy text and includes delivery and payment details",()=>{
  const sheet=buildMasterSheets("client",[{...emptyClient(),client_code:"001",client_name:"업체",
    business_number:"0012345678",contact_info:"이전 번호",phone:"02-1234-5678",contact_name:"홍담당",
    address:"사업장",shipping_address:"납품 공장",postal_code:"00123",payment_terms:"월말 마감",is_active:false}])[0];
  const row=Object.fromEntries(sheet.columns.map((column,i)=>[column.title,sheet.rows[0][i]]));
  assert.equal(row["사업자등록번호"],"001-23-45678");
  assert.equal(row["우편번호"],"00123");
  assert.equal(row["납품 주소"],"납품 공장");
  assert.equal(row["결제 조건"],"월말 마감");
  assert.equal(row["기존 연락처·메모"],"이전 번호");
  assert.equal(row["사용 상태"],"거래중지");
});
