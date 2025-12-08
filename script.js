// ====== 地図の初期化 ======
const map = L.map('map');
map.setView([35.681236, 139.767125], 13); // 初期位置（東京駅付近）

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

// ====== 住所検索用：ホームエリア設定 ======
// ★ここを自分の配達エリアに変える
// 例: "埼玉県川口市", "大阪府大阪市〇〇区" など
const BASE_AREA = "東京都千代田区";

// ====== データ管理（配達先） ======
// {id, kind, name, room, chome, note, paper, lat, lng, photo, marker}
let points = [];
let nextId = 1;
let currentSearchQuery = "";

// ====== データ管理（ルート） ======
let routePoints = [];   // {id, lat, lng, marker}
let routePolyline = null;
let isRouteMode = false;

// 新聞コード → 表示名
function getPaperLabel(paper) {
  switch (paper) {
    case "mainichi":
      return "毎日新聞";
    case "asahi":
      return "朝日新聞";
    case "nikkei":
      return "日経新聞";
    default:
      return "-";
  }
}

function loadPoints() {
  const raw = localStorage.getItem('newspaperPoints');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    parsed.forEach(p => {
      if (!('chome' in p)) p.chome = "";
      if (!('note' in p)) p.note = "";
      if (!('photo' in p)) p.photo = null;
      if (!('paper' in p)) p.paper = null; // 既存データ対策
      addPointToMap(p, false);
    });
    const maxId = parsed.reduce((max, p) => Math.max(max, p.id), 0);
    nextId = maxId + 1;
  } catch (e) {
    console.error("読み込みエラー", e);
  }
}

function savePoints() {
  const plain = points.map(p => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    room: p.room,
    chome: p.chome,
    note: p.note || "",
    paper: p.paper || null,
    lat: p.lat,
    lng: p.lng,
    photo: p.photo || null,
  }));
  localStorage.setItem("newspaperPoints", JSON.stringify(plain));
}

// ====== 画像ファイル → DataURL 変換ヘルパー ======
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// ====== 新規登録モーダル ======
const modal = document.getElementById("modal");
const roomRow = document.getElementById("roomRow");
const roomInput = document.getElementById("roomInput");
const nameInput = document.getElementById("nameInput");
const chomeInput = document.getElementById("chomeInput");
const noteInput = document.getElementById("noteInput");
const photoInput = document.getElementById("photoInput");
const paperSelect = document.getElementById("paperType");
const cancelBtn = document.getElementById("cancelBtn");
const saveBtn = document.getElementById("saveBtn");

let tempLatLng = null;
let isModalOpen = false; // モーダル二重オープン防止

function openModal(latlng) {
  tempLatLng = latlng;
  isModalOpen = true;
  document.querySelector('input[name="kind"][value="house"]').checked = true;
  roomRow.style.display = "none";
  roomInput.value = "";
  nameInput.value = "";
  chomeInput.value = "";
  noteInput.value = "";
  paperSelect.value = "mainichi"; // デフォルトを毎日に
  if (photoInput) photoInput.value = "";
  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
  tempLatLng = null;
  isModalOpen = false;
}

document.querySelectorAll('input[name="kind"]').forEach(el => {
  el.addEventListener("change", () => {
    if (el.value === "apartment" && el.checked) {
      roomRow.style.display = "block";
    } else if (el.value === "house" && el.checked) {
      roomRow.style.display = "none";
    }
  });
});

cancelBtn.addEventListener("click", () => {
  closeModal();
});

// 写真ありでも必ず閉じるように try/finally
saveBtn.addEventListener("click", async () => {
  if (!tempLatLng) return;

  try {
    const kind = document.querySelector('input[name="kind"]:checked').value;
    const name = nameInput.value.trim();
    const room = kind === "apartment" ? roomInput.value.trim() : "";
    const chome = chomeInput.value.trim();
    const note = noteInput.value.trim();
    const paper = paperSelect.value;
    const file = photoInput && photoInput.files ? photoInput.files[0] : null;

    if (!name) {
      alert("契約者名を入力してください");
      return;
    }

    let photoDataUrl = null;

    if (file) {
      try {
        photoDataUrl = await readFileAsDataURL(file);
      } catch (e) {
        console.error(e);
        alert("写真の読み込みに失敗しました。写真なしで登録します。");
        photoDataUrl = null;
      }
    }

    const newPoint = {
      id: nextId++,
      kind,
      name,
      room,
      chome,
      note,
      paper,
      lat: tempLatLng.lat,
      lng: tempLatLng.lng,
      photo: photoDataUrl,
    };

    addPointToMap(newPoint, true);

    // 入力欄リセット
    roomInput.value = "";
    nameInput.value = "";
    chomeInput.value = "";
    noteInput.value = "";
    paperSelect.value = "mainichi";
    if (photoInput) photoInput.value = "";

  } finally {
    // 成功でもエラーでも、必ずモーダルを閉じる
    closeModal();
  }
});

// ====== ルートモード関連 ======
const routeModeBtn = document.getElementById("routeModeBtn");

function updateRouteModeButton() {
  if (!routeModeBtn) return;
  if (isRouteMode) {
    routeModeBtn.classList.add("active");
    routeModeBtn.textContent = "📍 ルート中";
  } else {
    routeModeBtn.classList.remove("active");
    routeModeBtn.textContent = "📍 ルート";
  }
}

routeModeBtn.addEventListener("click", () => {
  isRouteMode = !isRouteMode;
  updateRouteModeButton();
});

// ルートピン追加
function addRoutePoint(latlng, doSave) {
  const marker = L.circleMarker(latlng, {
    radius: 6,
    color: "#ff9800",
    weight: 2,
    fillColor: "#ff9800",
    fillOpacity: 0.9,
  }).addTo(map);

  const point = {
    id: Date.now() + Math.random(),
    lat: latlng.lat,
    lng: latlng.lng,
    marker,
  };

  routePoints.push(point);
  updateRoutePolyline();

  if (doSave) saveRoute();
}

function updateRoutePolyline() {
  const latlngs = routePoints.map(p => [p.lat, p.lng]);

  if (!routePolyline) {
    routePolyline = L.polyline(latlngs, {
      color: "#ff9800",
      weight: 3,
    }).addTo(map);
  } else {
    routePolyline.setLatLngs(latlngs);
  }
}

function saveRoute() {
  const plain = routePoints.map(p => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
  }));
  localStorage.setItem("routePoints", JSON.stringify(plain));
}

function loadRoute() {
  const raw = localStorage.getItem("routePoints");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    parsed.forEach(p => {
      addRoutePoint({ lat: p.lat, lng: p.lng }, false);
    });
  } catch (e) {
    console.error("ルート読み込みエラー", e);
  }
}

function clearRoute() {
  routePoints.forEach(p => map.removeLayer(p.marker));
  routePoints = [];
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  localStorage.removeItem("routePoints");
}

// ====== 地図クリック：モードによる分岐 ======
map.on("click", e => {
  if (isModalOpen) return;

  if (isRouteMode) {
    // ルートモード中はルートピンを追加
    addRoutePoint(e.latlng, true);
  } else {
    // 通常モードなら配達先登録モーダル
    openModal(e.latlng);
  }
});

// ====== マーカー生成（新聞別の色） ======
function createColoredMarker(point) {
  let color = "#666666"; // デフォルト（新聞未設定）

  switch (point.paper) {
    case "mainichi":
      color = "#007bff"; // 毎日：青
      break;
    case "asahi":
      color = "#e53935"; // 朝日：赤
      break;
    case "nikkei":
      color = "#00c853"; // 日経：緑
      break;
  }

  return L.circleMarker([point.lat, point.lng], {
    radius: 9,
    color,
    weight: 2,
    fillColor: color,
    fillOpacity: 0.9,
  });
}

// ====== 詳細モーダル ======
const detailModal = document.getElementById("detailModal");
const detailPanel = document.getElementById("detailPanel");
const detailKind = document.getElementById("detailKind");
const detailPaper = document.getElementById("detailPaper");
const detailName = document.getElementById("detailName");
const detailChome = document.getElementById("detailChome");
const detailCoord = document.getElementById("detailCoord");
const detailNote = document.getElementById("detailNote");
const detailPhotoWrapper = document.getElementById("detailPhotoWrapper");
const detailPhoto = document.getElementById("detailPhoto");
const detailCloseBtn = document.getElementById("detailCloseBtn");
const detailDeleteBtn = document.getElementById("detailDeleteBtn");
const detailMapBtn = document.getElementById("detailMapBtn");

let currentDetailPointId = null;

function openDetailModal(point) {
  currentDetailPointId = point.id;

  const kindLabel =
    point.kind === "house"
      ? "一軒家"
      : `マンション（部屋：${point.room || "-"}）`;

  detailKind.textContent = kindLabel;
  detailPaper.textContent = getPaperLabel(point.paper);
  detailName.textContent = point.name || "-";
  detailChome.textContent = point.chome || "-";
  detailCoord.textContent = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  detailNote.textContent = point.note || "-";

  if (point.photo) {
    detailPhoto.src = point.photo;
    detailPhotoWrapper.style.display = "block";
  } else {
    detailPhotoWrapper.style.display = "none";
    detailPhoto.src = "";
  }

  detailModal.style.display = "flex";
  requestAnimationFrame(() => detailPanel.classList.add("show"));
}

function closeDetailModal() {
  detailPanel.classList.remove("show");
  setTimeout(() => {
    detailModal.style.display = "none";
    currentDetailPointId = null;
  }, 200);
}

detailCloseBtn.addEventListener("click", closeDetailModal);
detailModal.addEventListener("click", e => {
  if (e.target === detailModal) closeDetailModal();
});

// 地図へ移動したあと、詳細も一覧も閉じる
detailMapBtn.addEventListener("click", () => {
  if (currentDetailPointId == null) return;
  const p = points.find(pt => pt.id === currentDetailPointId);
  if (!p) return;

  map.setView([p.lat, p.lng], 18);
  p.marker.openPopup();

  closeDetailModal();
  closeListModal();
});

detailDeleteBtn.addEventListener("click", () => {
  if (currentDetailPointId == null) return;
  const p = points.find(pt => pt.id === currentDetailPointId);
  if (!p) return;
  const ok = confirm(`契約者「${p.name}」を削除しますか？`);
  if (!ok) return;
  deletePoint(currentDetailPointId);
  closeDetailModal();
});

// ====== 配達先一覧（スライドパネル） ======
const listModal = document.getElementById("listModal");
const listPanel = document.getElementById("listPanel");
const listEl = document.getElementById("list");
const openListBtn = document.getElementById("openListBtn");
const closeListBtn = document.getElementById("closeListBtn");
const clearRouteBtn = document.getElementById("clearRouteBtn");

function openListModal() {
  listModal.style.display = "flex";
  requestAnimationFrame(() => listPanel.classList.add("show"));
}

function closeListModal() {
  listPanel.classList.remove("show");
  setTimeout(() => {
    listModal.style.display = "none";
  }, 200);
}

openListBtn.addEventListener("click", openListModal);
closeListBtn.addEventListener("click", closeListModal);
listModal.addEventListener("click", e => {
  if (e.target === listModal) closeListModal();
});

clearRouteBtn.addEventListener("click", () => {
  if (routePoints.length === 0) return;
  const ok = confirm("ルート用ピンと線をすべて削除しますか？");
  if (!ok) return;
  clearRoute();
});

// ====== 検索（契約者名） ======
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearSearchBtn = document.getElementById("clearSearchBtn");

function applySearch() {
  currentSearchQuery = (searchInput.value || "").trim();
  renderList();
}

searchBtn.addEventListener("click", applySearch);
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") applySearch();
});
clearSearchBtn.addEventListener("click", () => {
  searchInput.value = "";
  currentSearchQuery = "";
  renderList();
});

// ====== 配達先追加・削除・一覧表示 ======
function addPointToMap(point, doSave) {
  const typeText =
    point.kind === "house"
      ? "（一軒家）"
      : `（マンション${point.room ? "／" + point.room + "号室" : ""}）`;

  const chomeText = point.chome ? `<br/>丁目：${point.chome}` : "";
  const noteText = point.note ? `<br/>備考：${point.note}` : "";

  const paperLabel = getPaperLabel(point.paper);
  const paperText = paperLabel !== "-" ? `<br/>新聞：${paperLabel}` : "";

  const photoHtml = point.photo
    ? `<br/><img src="${point.photo}" style="max-width:120px;max-height:120px;margin-top:4px;border-radius:4px;object-fit:cover;" />`
    : "";

  const label = `契約者：${point.name}${typeText}${paperText}${chomeText}${noteText}${photoHtml}`;

  const marker = createColoredMarker(point).addTo(map);
  marker.bindPopup(label);

  const fullPoint = { ...point, marker };
  points.push(fullPoint);
  renderList();

  if (doSave) savePoints();
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
  listEl.innerHTML = "";

  const q = currentSearchQuery;
  const filtered = q
    ? points.filter(p =>
        (p.name || "").toLowerCase().includes(q.toLowerCase())
      )
    : points;

  filtered.forEach(p => {
    const div = document.createElement("div");
    div.className = "point-item";

    const header = document.createElement("div");
    header.className = "point-item-header";

    const title = document.createElement("span");
    const paperLabel = getPaperLabel(p.paper);
    let titleText = "";

    if (paperLabel !== "-") {
      titleText += `[${paperLabel}] `;
    }

    titleText += `契約者：${p.name}`;
    if (p.kind === "house") {
      titleText += "（一軒家）";
    } else {
      titleText += "（マンション）";
    }
    if (p.chome) titleText += ` / ${p.chome}`;
    title.textContent = titleText;

    const btnArea = document.createElement("div");
    const detailBtn = document.createElement("button");
    detailBtn.textContent = "詳細";
    detailBtn.onclick = () => openDetailModal(p);
    btnArea.appendChild(detailBtn);

    header.appendChild(title);
    header.appendChild(btnArea);

    const coord = document.createElement("div");
    coord.textContent = `位置: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

    div.appendChild(header);
    div.appendChild(coord);

    if (p.note) {
      const noteDiv = document.createElement("div");
      noteDiv.className = "point-note";
      noteDiv.textContent = `備考: ${p.note}`;
      div.appendChild(noteDiv);
    }

    listEl.appendChild(div);
  });
}

// すべて削除（確認付き）
document.getElementById("clearAllBtn").addEventListener("click", () => {
  if (points.length === 0) return;
  const ok = confirm("登録されている配達先をすべて削除しますか？");
  if (!ok) return;
  points.forEach(p => map.removeLayer(p.marker));
  points = [];
  savePoints();
  renderList();
});

// ====== 現在地表示 ======
let myLocationMarker = null;

function moveToCurrentLocation() {
  if (!navigator.geolocation) {
    alert("この端末では位置情報が使えません");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      map.setView([lat, lng], 17);

      if (myLocationMarker) {
        map.removeLayer(myLocationMarker);
      }

      myLocationMarker = L.circleMarker([lat, lng], {
        radius: 10,
        color: "#00c853",
        weight: 3,
        fillColor: "#00e676",
        fillOpacity: 0.9,
      }).addTo(map);

      myLocationMarker.bindPopup("現在地");
    },
    err => {
      console.error(err);
      alert("位置情報を取得できませんでした");
    }
  );
}

document.getElementById("locateBtn").addEventListener("click", moveToCurrentLocation);

// ====== 住所検索（Nominatim・ホームエリア優先） ======
async function searchAddressAndMove() {
  const input = document.getElementById("addressInput");
  const q = (input.value || "").trim();
  if (!q) {
    alert("住所を入力してください");
    return;
  }

  // 「都・道・府・県」が含まれていないときは、ホームエリアを前に付ける
  let queryText = q;
  if (!q.match(/(都|道|府|県)/) && BASE_AREA) {
    queryText = BASE_AREA + " " + q;
  }

  try {
    const url =
      "https://nominatim.openstreetmap.org/search" +
      "?format=json" +
      "&limit=5" +                  // 複数候補を取る
      "&countrycodes=jp" +
      "&addressdetails=1" +
      "&q=" +
      encodeURIComponent(queryText);

    const res = await fetch(url, {
      headers: {
        "Accept-Language": "ja"
      }
    });

    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }

    let data = await res.json();

    if (!data || data.length === 0) {
      // ホームエリア付きで見つからなかった場合、元の文字列でもう一度トライ
      if (queryText !== q) {
        const fallbackUrl =
          "https://nominatim.openstreetmap.org/search" +
          "?format=json" +
          "&limit=5" +
          "&countrycodes=jp" +
          "&addressdetails=1" +
          "&q=" +
          encodeURIComponent(q);

        const res2 = await fetch(fallbackUrl, {
          headers: { "Accept-Language": "ja" }
        });

        data = await res2.json();
        if (!data || data.length === 0) {
          alert("その住所は見つかりませんでした");
          return;
        }
        moveToBestCandidate(data);
        return;
      }

      alert("その住所は見つかりませんでした");
      return;
    }

    moveToBestCandidate(data);
  } catch (e) {
    console.error(e);
    alert("住所検索中にエラーが発生しました");
  }
}

// 候補の中からホームエリアに近いものを優先して選ぶ
function moveToBestCandidate(candidates) {
  let best = candidates[0];

  if (BASE_AREA) {
    const hit = candidates.find(c =>
      (c.display_name || "").includes(BASE_AREA)
    );
    if (hit) {
      best = hit;
    }
  }

  const lat = parseFloat(best.lat);
  const lon = parseFloat(best.lon);
  map.setView([lat, lon], 18);
}

const addressInput = document.getElementById("addressInput");
const addressSearchBtn = document.getElementById("addressSearchBtn");

addressSearchBtn.addEventListener("click", searchAddressAndMove);
addressInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    searchAddressAndMove();
  }
});

// ====== 初期読み込み ======
updateRouteModeButton();
loadPoints();
loadRoute();
