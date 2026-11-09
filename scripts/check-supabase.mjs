const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Supabase server credentials are missing');
const response=await fetch(`${url}/rest/v1/hazards?select=id&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
console.log(JSON.stringify({status:response.status,hazardsTableAccessible:response.ok,message:response.ok?'Hazards table is ready':(await response.json()).message}));
