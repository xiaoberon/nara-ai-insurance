const { DatabaseSync }=require('node:sqlite');
const assert=require('node:assert/strict');
const fs=require('node:fs');

function sqliteAdapter(sqlite){
  function prepare(sql){
    const query=sqlite.prepare(sql);
    let params=[];
    return {
      bind(...values){params=values;return this},
      async first(){return query.get(...params)??null},
      async run(){return query.run(...params)},
      async all(){return {results:query.all(...params)}},
    };
  }
  return {prepare,async batch(statements){
    sqlite.exec('BEGIN');
    try{for(const statement of statements)await statement.run();sqlite.exec('COMMIT');}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
}
(async()=>{
  const worker=(await import('data:text/javascript;base64,'+fs.readFileSync('dist/server/index.js').toString('base64'))).default;
  const origin='https://nara.example';
  for(const [scope,total] of [['typical',75],['all',300]]){
    const sqlite=new DatabaseSync(':memory:');
    sqlite.exec(fs.readFileSync('deploy/evaluation-jobs.sql','utf8'));
    const env={DB:sqliteAdapter(sqlite),GEMINI_API_KEY:'test-key-not-used',NARA_ALLOWED_COUNTRIES:'US',NARA_BATCH_MAX_CALLS:'650'};
    const call=(path,method='GET',body,country='US')=>worker.fetch(new Request(origin+path,{
      method,headers:{origin,'CF-IPCountry':country,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
    }),env);
    assert.equal((await call('/live/api/evaluations','POST',{scope},'CN')).status,403);
    const created=await call('/live/api/evaluations','POST',{scope});
    assert.equal(created.status,202);
    const job=await created.json();assert.equal(job.total,total);
    assert.equal((await call('/live/api/evaluations','POST',{scope})).status,429);
    const path='/live/api/evaluations/'+job.id;
    assert.equal((await (await call(path)).json()).completed,0);
    sqlite.prepare('UPDATE evaluation_jobs SET completed=? WHERE id=?').run(total/3,job.id);
    const adv=await call(path+'/advance','POST');
    assert.equal((await adv.json()).completed,total/3+1);
    const saved=sqlite.prepare('SELECT result FROM evaluation_rounds WHERE job_id=?').get(job.id).result;
    const insert=sqlite.prepare('INSERT OR IGNORE INTO evaluation_rounds (job_id,ordinal,result) VALUES (?,?,?)');
    for(let i=0;i<total;i++)insert.run(job.id,i,saved);
    sqlite.prepare("UPDATE evaluation_jobs SET completed=total,state='completed' WHERE id=?").run(job.id);
    const finished=await (await call(path+'/result')).json();
    assert.equal(finished.execution_count,total);
    assert.equal(finished.case_results.length,total/15);
    assert.equal(finished.case_results[0].modes.rules_only.rounds.length,5);
    assert.equal((await (await call('/live/api/evaluations?scope='+scope)).json()).id,job.id);
    sqlite.close();
    console.log(total+'-run job: admission, region gate, resume, durable round, grading and export passed');
  }
})().catch(error=>{console.error(error);process.exit(1)});
