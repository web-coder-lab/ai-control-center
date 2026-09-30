import React from 'react';

export function ServicesView() {
  const services = [
    { id:'github', name:'GitHub', category:'Code & repositories', description:'Connect real GitHub accounts for repository operations and deployment source control.' },
    { id:'render', name:'Render', category:'Deployment', description:'Connect Render accounts/workspaces for real services, deployments, logs, domains and environment configuration.' },
    { id:'cloudflare', name:'Cloudflare', category:'DNS & edge', description:'Connect Cloudflare API credentials for supported DNS and edge operations.' },
    { id:'vercel', name:'Vercel', category:'Deployment', description:'Connect Vercel API credentials for supported projects and deployments.' },
    { id:'netlify', name:'Netlify', category:'Deployment', description:'Connect Netlify API credentials for supported sites and deployments.' },
    { id:'supabase', name:'Supabase', category:'Database & backend', description:'Connect Supabase API credentials for supported project operations.' },
    { id:'digitalocean', name:'DigitalOcean', category:'Infrastructure', description:'Connect DigitalOcean API credentials for supported infrastructure operations.' },
        { id:'gitdb', name:'GitDB', category:'Database', description:'Git-native object database at github-store.onrender.com. Lists and writes real objects with a GitDB API key.' },
    { id:'google-browser', name:'Google (Browser Only)', category:'Web services', description:'Use Gmail, Sheets, Drive, Ads and other Google web interfaces through isolated local Chrome sessions. No Google API/OAuth credentials are used.' },
  ];
  return <div className="p-6 space-y-4">
    <div><h2 className="text-lg font-semibold text-slate-100">Connected Services</h2><p className="text-xs text-slate-500 mt-1">Only real connected adapters and the local browser bridge are shown. Google is browser-only.</p></div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {services.map((service) => <div key={service.id} className="p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex items-center justify-between"><div className="font-semibold text-slate-200">{service.name}</div><span className="text-[10px] text-slate-500 uppercase">{service.category}</span></div>
        <p className="text-xs text-slate-400 mt-2 leading-5">{service.description}</p>
      </div>)}
    </div>
  </div>;
}
