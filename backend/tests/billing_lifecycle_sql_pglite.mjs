import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.on('uncaughtException', error => { console.error('FAIL', error.code || '', error.message); process.exit(1); });
const { PGlite } = require(process.env.PGLITE_PACKAGE || '@electric-sql/pglite');
const db = new PGlite();
const table = (file, name) => { const s=fs.readFileSync(file,'utf8'); const i=s.toLowerCase().indexOf('create table if not exists public.'+name+' (');return s.slice(i,s.indexOf(');',i)+2); };
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
await db.exec(table('docs/SUPABASE_SCHEMA.sql','subscriptions'));
// Retained production legacy tiers must remain compatible with lifecycle enforcement.
await db.exec("ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_plan_check; ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK(plan IN ('starter','growth','pro','redbubble','teepublic','all_platforms'))");
await db.exec(table('docs/migration_ai_usage_table.sql','ai_usage'));
await db.exec('CREATE UNIQUE INDEX ai_usage_user_day_idx ON ai_usage(user_id,day_key);');
await db.exec(table('docs/migration_paddle_checkout_intents.sql','paddle_checkout_intents'));
await db.exec(fs.readFileSync('docs/migration_paddle_webhook_idempotency.sql','utf8'));
await db.exec(fs.readFileSync('docs/migration_paddle_live_fulfillment.sql','utf8'));
const u='00000000-0000-0000-0000-000000000001';
await db.query('INSERT INTO auth.users VALUES ($1)',[u]);
await db.query("INSERT INTO subscriptions(user_id,plan,status,ai_tokens) VALUES($1,'redbubble','inactive',2)",[u]);
if (process.env.LIVE_BILLING_FUNCTION_SNAPSHOT) {
  const live=JSON.parse(fs.readFileSync(process.env.LIVE_BILLING_FUNCTION_SNAPSHOT,'utf8'));
  await db.exec(live.consume_ai_token_atomic.definition);
  await db.exec('GRANT EXECUTE ON FUNCTION consume_ai_token_atomic(uuid) TO anon,authenticated; SET ROLE anon;');
  assert.equal((await db.query('SELECT * FROM consume_ai_token_atomic($1)',[u])).rows[0].remaining_extra,1);
  await db.exec('RESET ROLE');
  console.log('REPRODUCED LIVE bug in disposable PostgreSQL: anonymous role can spend another user credit');
}
const sql=fs.readFileSync('docs/migration_billing_lifecycle_safety.sql','utf8');
await db.exec(sql);
async function setup(status, age=0, futureEnd=true, balance=0, scheduled=false) {
  await db.exec('DELETE FROM ai_usage');
  await db.query("UPDATE subscriptions SET status='inactive',paddle_event_at=now()",[]);
  await db.query(`UPDATE subscriptions SET status=$1,paddle_event_at=now()-make_interval(days=>$2),
    current_period_ends_at=now()+make_interval(days=>$3),ai_tokens=$4,cancel_at_period_end=$5`,[status,age,futureEnd?28:-1,balance,scheduled]);
}
async function consume(grace=3) { return (await db.query('SELECT * FROM consume_ai_token_atomic($1,$2)',[u,grace])).rows; }
for (const role of ['anon','authenticated']) {
  for (const fn of ['consume_ai_token_atomic(uuid)','consume_ai_token_atomic(uuid,integer)','refund_ai_token_reservation_atomic(uuid,text,text)'])
    assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,fn])).rows[0].allowed,false);
}
console.log('PASS both browser roles denied all consumption/refund RPCs');
await setup('active'); assert.equal((await consume())[0].token_source,'daily');
await setup('active',0,false); assert.equal((await consume()).length,0);
await setup('canceled',0,true); assert.equal((await consume()).length,0);
await setup('active',0,true,0,true); assert.equal((await consume())[0].token_source,'daily');
await setup('active'); await db.exec("UPDATE subscriptions SET plan='pro'");
assert.equal((await consume())[0].remaining_daily,149);
await db.exec("UPDATE subscriptions SET plan='redbubble'");
console.log('PASS current, expired, immediate cancellation and scheduled cancellation daily entitlements');
await setup('past_due',2); assert.equal((await consume())[0].token_source,'daily');
await setup('past_due',4); assert.equal((await consume()).length,0);
await setup('past_due',3); assert.equal((await consume()).length,0);
await setup('past_due',-1); assert.equal((await consume()).length,0);
await setup('past_due',1); assert.equal((await consume(0)).length,0);
console.log('PASS grace availability, exhaustion, exact boundary, future timestamp and zero-grace configuration');
await setup('past_due',4,true,10);
const pinned=(await db.query('SELECT past_due_since FROM subscriptions')).rows[0].past_due_since;
await db.exec('UPDATE subscriptions SET ai_tokens=ai_tokens+1000,updated_at=now(),paddle_event_at=now()');
assert.deepEqual((await db.query('SELECT past_due_since FROM subscriptions')).rows[0].past_due_since,pinned);
assert.equal((await consume())[0].token_source,'extra');
console.log('PASS credit purchases and repeated webhooks cannot extend grace; purchased credits remain usable');
await db.exec("UPDATE subscriptions SET status='active',current_period_ends_at=now()+interval '30 days'");
assert.equal((await db.query('SELECT past_due_since FROM subscriptions')).rows[0].past_due_since,null);
assert.equal((await consume())[0].token_source,'daily');
console.log('PASS payment recovery clears past-due metadata and restores daily benefits');
await setup('canceled',0,true,1); await consume();
await db.exec('UPDATE subscriptions SET ai_tokens=ai_tokens+1000');
await db.query("SELECT refund_ai_token_reservation_atomic($1,'extra','2026-11-28')",[u]);
assert.equal((await db.query('SELECT ai_tokens FROM subscriptions')).rows[0].ai_tokens,1001);
await setup('active'); await consume();
await db.query("SELECT refund_ai_token_reservation_atomic($1,'daily',to_char(timezone('UTC',now()),'YYYY-MM-DD'))",[u]);
assert.equal((await db.query('SELECT used_count FROM ai_usage')).rows[0].used_count,0);
console.log('PASS provider-failure refunds preserve intervening purchases and restore daily usage');
await setup('active',0,true,17);
await db.exec("UPDATE subscriptions SET paddle_event_at=NULL,paddle_subscription_id='sub_lifecycle'");
const snapshot={user_id:u,plan:'redbubble',status:'past_due',paddle_subscription_id:'sub_lifecycle',
  paddle_customer_id:'ctm_lifecycle',current_period_ends_at:new Date(Date.now()+86400000*20).toISOString(),cancel_at_period_end:false};
async function apply(status,age,scheduled=false) {
  const timestamp=new Date(Date.now()-86400000*age).toISOString();
  return (await db.query('SELECT paddle_apply_subscription($1,$2,$3) AS applied',
    [{...snapshot,status,cancel_at_period_end:scheduled},'evt_'+status+'_'+age,timestamp])).rows[0].applied;
}
assert.equal(await apply('past_due',4),true);assert.equal((await consume()).at(0)?.token_source,'extra');
assert.equal(await apply('active',3),true);assert.equal((await consume()).at(0)?.token_source,'daily');
assert.equal(await apply('active',2,true),true);assert.equal((await consume()).at(0)?.token_source,'daily');
assert.equal(await apply('canceled',1),true);assert.equal((await consume()).at(0)?.token_source,'extra');
assert.equal(await apply('active',3),false);
const lifecycleRow=(await db.query('SELECT status,ai_tokens FROM subscriptions')).rows[0];
assert.deepEqual(lifecycleRow,{status:'canceled',ai_tokens:15});
console.log('PASS actual webhook SQL snapshots: grace lock, recovery, scheduled/immediate cancellation and stale-event rejection preserve credits');
const balance=(await db.query('SELECT ai_tokens FROM subscriptions')).rows[0].ai_tokens;
await db.exec(sql);
assert.equal((await db.query('SELECT ai_tokens FROM subscriptions')).rows[0].ai_tokens,balance);
assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='subscriptions_track_past_due_since'")).rows[0].n,1);
console.log('PASS migration replay preserves balances and does not duplicate trigger');
await db.close();
