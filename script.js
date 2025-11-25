// ====== 地図の初期化 ======
const map = L.map('map');

// 初期表示位置（お好みで配達エリア付近に）
map.setView([35.681236, 139.767125], 13); // 東京駅付近

// OpenStreetMap のタイルを表示
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

// ====== データ管理 ======
// {id, kind, name, room, chome, lat, lng, marker}
let points = [];
let nextId = 1;

// localStorageから読み込み
function loadPoints() {
  const raw = localStorage.getItem('newspaperPoints');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    parsed.forEach(p => {
      if (!('chome' in p)) p.chome = '';
      addPointToMap(p, false);
    });
    const maxId = parsed.reduce((max, p) => Math.max(max, p.id), 0);
    nextId = maxId + 1;
  } catch (e) {
    console.error('読み込みエラー', e);
  }
}

function savePoints() {
  const plain = points.map(p => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    room: p.room,
    chome: p.chome,
    lat: p.lat,
    lng: p.lng,
  }));
  localStorage.setItem('newspaperPoints', JSON.stringify(plain));
}

// ====== モーダル（入力フォーム）管理 ======
const modal = document.getElementById('modal');
const roomRow = document.getElementById('roomRow');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const chomeInput = document.getElementById('chomeInput');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

let tempLatLng = null; // クリックした位置を一時保存

function openModal(latlng) {
  tempLatLng = latlng;
  document.querySelector('input[name="kind"][value="house"]').checked = true;
  roomRow.style.display = 'none';
  roomInput.value = '';
  nameInput.value = '';
  chomeInput.value = '';
  modal.style.display = 'flex';
}

function closeModal() {
  modal.style.display = 'none';
  tempLatLng = null;
}

// 種類選択で部屋番号の行を表示/非表示
document.querySelectorAll('input[name="kind"]').forEach(el => {
  el.addEventListener('change', () => {
    if (el.value === 'apartment' && el.checked) {
      roomRow.style.display = 'block';
    } else if (el.value === 'house' && el.checked) {
      roomRow.style.display = 'none';
    }
  });
});

cancelBtn.addEventListener('click', () => {
  closeModal();
});

saveBtn.addEventListener('click', () => {
  if (!tempLatLng) return;
  const kind = document.querySelector('input[name="kind"]:checked').value;
  const name = nameInput.value.trim();
  const room = kind === 'apartment' ? roomInput.value.trim() : '';
  const chome = chomeInput.value.trim();

  if (!name) {
    alert('主の名前を入力してください');
    return;
  }

  const newPoint = {
    id: nextId++,
    kind,
    name,
    room,
    chome,
    lat: tempLatLng.lat,
    lng: tempLatLng.lng,
  };

  addPointToMap(newPoint, true);
  closeModal();
});

// ====== 地図タップで新規登録モーダル ======
map.on('click', (e) => {
  openModal(e.latlng);
});

// ====== マーカー生成（色分け・不透明） ======
function createColoredMarker(point) {
  const isHouse = point.kind === 'house';
  const color = isHouse ? '#007bff' : '#e53935'; // 青：一軒家／赤：マンション

  return L.circleMarker([point.lat, point.lng], {
    radius: 9,
    color: color,
    weight: 2,
    fillColor: color,
    fillOpacity: 0.9, // ほぼ不透明
  });
}

// ====== ポイント追加・削除 ======
const listEl = document.getElementById('list');

function addPointToMap(point, doSave) {
  const labelBase =
    point.kind === 'house'
      ? `一軒家：${point.name}`
      : `マンション：${point.name}（${point.room}）`;

  const labelChome = point.chome ? `<br/>丁目：${point.chome}` : '';
  const label = labelBase + labelChome;

  const marker = createColoredMarker(point).addTo(map);
  marker.bindPopup(label);

  const fullPoint = { ...point, marker };
  points.push(fullPoint);
  renderList();

  if (doSave) {
    savePoints();
  }
}

function deletePoint(id) {
  const idx = points.findIndex(p => p.id === id);
  if (idx === -1) return;
  const p = points[idx];
  map.removeLayer(p.marker);
  points.splice(idx, 1);
  renderList();
  savePoints();
}

function renderList() {
  listEl.innerHTML = '';

  points.forEach(p => {
    const div = document.createElement('div');
    div.className = 'point-item';

    const header = document.createElement('div');
    header.className = 'point-item-header';

    const title = document.createElement('span');
    let titleText = '';
    if (p.kind === 'house') {
      titleText = `一軒家：${p.name}`;
    } else {
      titleText = `マンション：${p.name}（${p.room}）`;
    }
    if (p.chome) {
      titleText += ` / ${p.chome}`;
    }
    title.textContent = titleText;

    const btnArea = document.createElement('div');
    const zoomBtn = document.createElement('button');
    zoomBtn.textContent = '地図へ';
    zoomBtn.onclick = () => {
      map.setView([p.lat, p.lng], 18);
      p.marker.openPopup();
    };

    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.onclick = () => {
      if (confirm('この配達先を削除しますか？')) {
        deletePoint(p.id);
      }
    };

    btnArea.appendChild(zoomBtn);
    btnArea.appendChild(delBtn);

    header.appendChild(title);
    header.appendChild(btnArea);

    const coord = document.createElement('div');
    coord.textContent =
      `位置: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

    div.appendChild(header);
    div.appendChild(coord);
    listEl.appendChild(div);
  });
}

// すべて削除ボタン
document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (!confirm('すべての配達先を削除しますか？')) return;
  points.forEach(p => map.removeLayer(p.marker));
  points = [];
  savePoints();
  renderList();
});

// ====== 現在地表示（スマホ向け） ======
let myLocationMarker = null;

function moveToCurrentLocation() {
  if (!navigator.geolocation) {
    alert('この端末では位置情報が使えません');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      map.setView([lat, lng], 17);

      if (myLocationMarker) {
        map.removeLayer(myLocationMarker);
      }

      myLocationMarker = L.circleMarker([lat, lng], {
        radius: 10,
        color: '#00c853',
        weight: 3,
        fillColor: '#00e676',
        fillOpacity: 0.9,
      }).addTo(map);

      myLocationMarker.bindPopup('現在地');
    },
    (err) => {
      console.error(err);
      alert('位置情報を取得できませんでした');
    }
  );
}

document.getElementById('locateBtn').addEventListener('click', moveToCurrentLocation);

// ====== 初期読み込み ======
loadPoints();
