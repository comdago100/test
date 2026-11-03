import {test} from "node:test";
import assert from "node:assert/strict";
import {receiptAmount} from "../lib/erp-data.js";
import {erpSheets} from "../lib/erp-export.js";
test("purchase preview rounds decimal products as PostgreSQL numeric does, including zero and half-won",()=>{
 assert.equal(receiptAmount("25.125","1234.5"),"31017");assert.equal(receiptAmount("10.125",0),"0");assert.equal(receiptAmount("1.005","100"),"101");assert.equal(receiptAmount("","10"),null);
});
test("sales export leaves unknown shipment blank and inventory exports preserve unknown-job counts",()=>{
 const s=erpSheets("sales",[{order_no:"0001",quantity:100,allocated_qty:100,unconfirmed_count:1,shipped_qty:0,remaining_qty:100,unit_price:null,amount:null,status:"수량 확인 필요"}])[0];assert.equal(s.rows[0][0],"0001");assert.equal(s.rows[0][4],null);assert.equal(s.rows[0][8],null);assert.equal(s.rows[0][9],null);
 const p=erpSheets("products",[{item_code:"001",produced_qty:20,shipped_qty:7,before_quality:13,scrapped_qty:1,on_hand:12,held_qty:2,available_qty:10,untracked_count:1}])[0];assert.deepEqual(p.rows[0].slice(2),[20,7,13,1,12,2,10,1]);
});
