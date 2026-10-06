const $ = (s) => document.querySelector(s);

const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.status === 204 ? null : res.json();
};

const act = (p) => p.then(load).catch((e) => alert(e.message));

async function load() {
  const tasks = await api('/api/tasks');
  const ul = $('#list');
  ul.replaceChildren();
  for (const t of tasks) {
    const li = document.createElement('li');
    if (t.done) li.className = 'done';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.onchange = () => act(api(`/api/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ done: cb.checked }) }));

    const span = document.createElement('span');
    span.textContent = t.title;
    span.ondblclick = () => {
      const v = prompt('Edit task', t.title);
      if (v && v.trim()) act(api(`/api/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ title: v }) }));
    };

    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = () => act(api(`/api/tasks/${t.id}`, { method: 'DELETE' }));

    li.append(cb, span, del);
    ul.append(li);
  }
}

$('#form').onsubmit = (e) => {
  e.preventDefault();
  const title = $('#title').value.trim();
  if (!title) return;
  $('#title').value = '';
  act(api('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) }));
};

api('/api/info')
  .then((i) => ($('#info').textContent = `${i.instanceId} | ${i.az}`))
  .catch(() => ($('#info').textContent = 'unknown'));

load().catch((e) => alert(e.message));
