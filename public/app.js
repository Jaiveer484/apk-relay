const get = id => document.getElementById(id);
const status = get('status');
const fileInput = get('file');
const progress = get('progress');
const receive = location.pathname.match(/^\/receive\/([0-9a-f-]{36})$/);
const expiryTime = value => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

if (receive) {
  get('sender').hidden = true;
  get('receiver').hidden = false;
  const id = receive[1];
  status.textContent = 'Loading transfer…';
  try {
    const response = await fetch('/api/uploads/' + id);
    const file = await response.json();
    if (!response.ok) throw new Error(file.error);
    get('name').textContent = file.name;
    get('size').textContent = new Intl.NumberFormat().format(file.size) + ' bytes · Expires at ' + expiryTime(file.expiresAt);
    get('download').href = '/download/' + id;
    get('details').hidden = false;
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
} else {
  const drop = get('drop');
  for (const event of ['dragenter', 'dragover']) {
    drop.addEventListener(event, e => {
      e.preventDefault();
      drop.classList.add('active');
    });
  }
  drop.addEventListener('dragleave', e => {
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('active');
  });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (!file || fileInput.disabled) return;
    const selection = new DataTransfer();
    selection.items.add(file);
    fileInput.files = selection.files;
  });

  get('upload').addEventListener('submit', e => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file || !/\.apk$/i.test(file.name) || file.size < 4 || file.size > 100 * 1024 * 1024) {
      status.textContent = 'Choose an APK up to 100 MB.';
      return;
    }
    const button = e.currentTarget.querySelector('button');
    button.disabled = fileInput.disabled = true;
    progress.hidden = false;
    progress.value = 0;
    get('share').hidden = true;
    status.textContent = 'Uploading…';

    const request = new XMLHttpRequest();
    request.open('POST', '/api/uploads');
    request.responseType = 'json';
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.upload.onprogress = event => {
      if (event.lengthComputable) progress.value = 100 * event.loaded / event.total;
    };
    request.onloadend = () => {
      button.disabled = fileInput.disabled = false;
      progress.hidden = true;
      if (request.status !== 201) {
        status.textContent = request.response?.error ?? 'Upload failed. Try again.';
        return;
      }
      const { id, expiresAt } = request.response;
      get('link').value = location.origin + '/receive/' + id;
      get('qr').src = '/qr/' + id + '?origin=' + encodeURIComponent(location.origin);
      get('expiry').textContent = 'Expires at ' + expiryTime(expiresAt);
      get('share').hidden = false;
      status.textContent = 'Your APK is ready to share.';
    };
    request.send(file);
  });

  get('copy').onclick = async () => {
    const field = get('link');
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = 'Link copied.';
    } catch {
      field.select();
      status.textContent = document.execCommand('copy') ? 'Link copied.' : 'Link selected. Copy it to share.';
    }
  };
}
