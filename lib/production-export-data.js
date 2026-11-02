import { historyBounds } from "./production-export.js";

// Keep encoded query strings small even when order numbers contain Korean characters.
function batches(ids) {
  const result = [];
  let batch = [], size = 0;
  for (const id of new Set(ids)) {
    const length = encodeURIComponent(id).length + 3;
    if (batch.length && (size + length > 1500 || batch.length >= 100)) {
      result.push(batch); batch = []; size = 0;
    }
    batch.push(id); size += length;
  }
  if (batch.length) result.push(batch);
  return result;
}

export async function fetchProductionEvents(client, orderIds, options = {}) {
  const { from, until } = historyBounds(options.start, options.end);
  const asOf = new Date(options.generatedAt || new Date()).toISOString();
  const pageSize = 1000;
  const rows = [];
  for (const ids of batches(orderIds)) {
    for (let start = 0; ; start += pageSize) {
      let query = client.from("production_events").select("*").in("wo_id", ids)
        .lte("created_at", asOf).order("created_at").order("event_id");
      if (from) query = query.gte("created_at", from);
      if (until) query = query.lt("created_at", until);
      const { data, error } = await query.range(start, start + pageSize - 1);
      if (error) throw new Error("공정·출고 이력을 불러오지 못했습니다. 연결 상태와 DB 읽기 권한을 확인한 뒤 다시 받으세요.");
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
  }
  return rows;
}
