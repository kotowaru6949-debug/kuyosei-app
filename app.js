// 満正寺 九曜星占盤 Webアプリケーション ロジック
function __kuyoseiAppBootstrap() {

const STORAGE_KEY = "manshoji_kuyosei_members_v2";
const MODE_STORAGE_KEY = "manshoji_kuyosei_calcmode_v2";

// アプリ状態
const state = {
  members: [],
  selfId: null,
  partnerId: null,
  singleTargetId: null,
  focusMemberId: null,
  matrixViewMode: "focus", // "focus" (選んだ人とメンバーの相性のみ) | "all" (全員総当たり)
  calcMode: "manshoji_table", // "manshoji_table" (月×日宿星帳早見表: 12/6=婁宿) | "lunar_jp" (旧暦換算)
  targetYear: new Date().getFullYear(),
  useSetsubunBoundary: true,
  wheelRotationDeg: 0
};

/**
 * 新暦(YYYY-MM-DD)から旧暦の月・日を算出する
 */
function gregorianToLunar(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d, 12, 0, 0);

  try {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-chinese", {
      year: "numeric",
      month: "numeric",
      day: "numeric"
    });
    const parts = formatter.formatToParts(dateObj);
    const monthPart = parts.find((p) => p.type === "month")?.value || "1";
    const dayPart = parts.find((p) => p.type === "day")?.value || "1";

    const lunarMonth = Math.max(1, Math.min(12, parseInt(monthPart, 10) || 1));
    const lunarDay = Math.max(1, Math.min(30, parseInt(dayPart, 10) || 1));
    const isLeapMonth = /bis|leap/i.test(monthPart) || isNaN(Number(monthPart));

    return { lunarMonth, lunarDay, isLeapMonth };
  } catch (err) {
    const synodicMonth = 29.53058867;
    const refNewMoon = new Date(2000, 0, 6, 18, 14, 0).getTime();
    const diffDays = (dateObj.getTime() - refNewMoon) / 86400000;
    const lunarCycle = ((diffDays % synodicMonth) + synodicMonth) % synodicMonth;
    const lunarDay = Math.max(1, Math.min(30, Math.floor(lunarCycle) + 1));
    const approxMonth = ((m - 2 + 12) % 12) + 1;
    return { lunarMonth: approxMonth, lunarDay, isLeapMonth: false };
  }
}

/**
 * 生年月日（および任意の宿星上書き）から宿星・九曜星・本命星を一括計算
 */
function calculatePersonAstrology(member, targetYear = state.targetYear, useSetsubun = state.useSetsubunBoundary) {
  const [birthY, birthM, birthD] = member.birthdate.split("-").map(Number);
  const { lunarMonth, lunarDay, isLeapMonth } = gregorianToLunar(member.birthdate);

  let shukuIndex;
  let lookupLabel;

  if (typeof member.overrideShukuIndex === "number" && member.overrideShukuIndex >= 0 && member.overrideShukuIndex < 27) {
    shukuIndex = member.overrideShukuIndex;
    lookupLabel = "手動指定";
  } else if (state.calcMode === "manshoji_table") {
    const startIdx = SHUKU_START_BY_LUNAR_MONTH[birthM] ?? 11;
    shukuIndex = (startIdx + (birthD - 1)) % 27;
    lookupLabel = `宿星帳 ${birthM}月×${birthD}日`;
  } else {
    const startIdx = SHUKU_START_BY_LUNAR_MONTH[lunarMonth] ?? 11;
    shukuIndex = (startIdx + (lunarDay - 1)) % 27;
    lookupLabel = `旧暦 ${isLeapMonth ? "閏" : ""}${lunarMonth}月${lunarDay}日`;
  }

  const shuku = SHUKU_27_DATA[shukuIndex];

  const isBeforeSetsubun = useSetsubun && (birthM === 1 || (birthM === 2 && birthD <= 3));
  const effectiveBirthYear = isBeforeSetsubun ? birthY - 1 : birthY;

  const kazoeAge = Math.max(1, targetYear - effectiveBirthYear + 1);
  const tonenMod = ((kazoeAge % 9) + 9) % 9;
  const tonenStar = KUYOSEI_TONEN_DATA[tonenMod];

  const kyuseiNum = ((11 - (effectiveBirthYear % 9)) % 9) || 9;
  const honmeiStar = HONMEI_NINE_STARS[kyuseiNum];

  return {
    birthY,
    birthM,
    birthD,
    shukuIndex,
    shuku,
    lookupLabel,
    lunarMonth,
    lunarDay,
    isLeapMonth,
    effectiveBirthYear,
    kazoeAge,
    tonenMod,
    tonenStar,
    kyuseiNum,
    honmeiStar
  };
}

/**
 * 2人の宿星インデックスから三九の秘法による相性を計算
 */
function calculateCompatibility(selfShukuIdx, partnerShukuIdx) {
  const forwardOffset = (partnerShukuIdx - selfShukuIdx + 27) % 27;
  const reverseOffset = (selfShukuIdx - partnerShukuIdx + 27) % 27;

  const selfToPartnerLabel = SANKU_WHEEL_LABELS[forwardOffset];
  const partnerToSelfLabel = SANKU_WHEEL_LABELS[reverseOffset];

  const shortestStep = Math.min(forwardOffset, reverseOffset);
  const groupInfo = COMPATIBILITY_GROUPS[selfToPartnerLabel.group];
  const distanceInfo = DISTANCE_COMMENTARY[selfToPartnerLabel.distance];

  const score = Math.min(99, groupInfo.scoreBase + (distanceInfo?.BonusScore || 0));

  return {
    forwardOffset,
    reverseOffset,
    shortestStep,
    selfToPartner: selfToPartnerLabel,
    partnerToSelf: partnerToSelfLabel,
    groupKey: selfToPartnerLabel.group,
    distanceKey: selfToPartnerLabel.distance,
    groupInfo,
    distanceInfo,
    score
  };
}

/**
 * 指定した宿星にとって結婚相性が最も良い宿星（栄親の中距離・近距離、業胎）を抽出
 */
function getBestMarriageShukuList(selfShukuIdx, excludeMemberId = null) {
  // 他の登録メンバーの宿星マップ
  const friendMap = new Map();
  state.members.forEach((m) => {
    if (m.id === excludeMemberId) return;
    const a = calculatePersonAstrology(m);
    if (!friendMap.has(a.shukuIndex)) friendMap.set(a.shukuIndex, []);
    friendMap.get(a.shukuIndex).push(m.name);
  });

  // オフセット：8, 19 (栄親・中距離 100点級), 1, 26 (栄親・近距離), 9, 18 (業・胎)
  const targetOffsets = [
    { offset: 8, reason: "親（中距離・最高安定の結婚縁）" },
    { offset: 19, reason: "栄（中距離・最高安定の結婚縁）" },
    { offset: 1, reason: "栄（近距離・強く惹かれ合う大吉縁）" },
    { offset: 26, reason: "親（近距離・強く惹かれ合う大吉縁）" },
    { offset: 9, reason: "業（前世からの深い宿縁）" },
    { offset: 18, reason: "胎（来世へ続く温かい宿縁）" }
  ];

  return targetOffsets.map((item) => {
    const idx = (selfShukuIdx + item.offset) % 27;
    const shuku = SHUKU_27_DATA[idx];
    const matchedFriends = friendMap.get(idx) || [];
    return {
      shukuIndex: idx,
      shuku,
      reason: item.reason,
      matchedFriends
    };
  });
}

/**
 * 九曜星占盤（SVG）の描画
 */
function buildSenbanSVG() {
  const outerGroup = document.getElementById("outer-shuku-ring");
  const innerGroup = document.getElementById("inner-sanku-wheel");
  if (!outerGroup || !innerGroup) return;

  outerGroup.innerHTML = "";
  innerGroup.innerHTML = "";

  const cx = 250;
  const cy = 250;
  const stepDeg = 360 / 27;

  const dirColorMap = {
    "東方青龍": "#1b4353",
    "北方玄武": "#23293a",
    "西方白虎": "#4a3f28",
    "南方朱雀": "#542323"
  };

  const polarToCartesian = (r, deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  };

  const createSectorPath = (rOuter, rInner, startDeg, endDeg) => {
    const p1 = polarToCartesian(rOuter, startDeg);
    const p2 = polarToCartesian(rOuter, endDeg);
    const p3 = polarToCartesian(rInner, endDeg);
    const p4 = polarToCartesian(rInner, startDeg);
    return [
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${rOuter} ${rOuter} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
      `A ${rInner} ${rInner} 0 0 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
      "Z"
    ].join(" ");
  };

  // 1. 外周リング（27宿：固定盤）
  SHUKU_27_DATA.forEach((shuku, idx) => {
    const centerDeg = idx * stepDeg;
    const startDeg = centerDeg - stepDeg / 2;
    const endDeg = centerDeg + stepDeg / 2;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "shuku-sector");
    g.setAttribute("data-shuku-idx", String(idx));
    g.style.cursor = "pointer";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", createSectorPath(240, 168, startDeg, endDeg));
    path.setAttribute("fill", dirColorMap[shuku.direction] || "#231e2c");
    path.setAttribute("stroke", "#d4af37");
    path.setAttribute("stroke-width", "1");
    path.setAttribute("class", "shuku-sector-bg");
    g.appendChild(path);

    const textPos = polarToCartesian(207, centerDeg);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", textPos.x.toFixed(2));
    text.setAttribute("y", textPos.y.toFixed(2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("fill", "#f7f3e9");
    text.setAttribute("font-size", "15");
    text.setAttribute("font-weight", "700");
    text.setAttribute("transform", `rotate(${centerDeg}, ${textPos.x.toFixed(2)}, ${textPos.y.toFixed(2)})`);
    text.textContent = shuku.short;
    g.appendChild(text);

    const subPos = polarToCartesian(182, centerDeg);
    const subText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    subText.setAttribute("x", subPos.x.toFixed(2));
    subText.setAttribute("y", subPos.y.toFixed(2));
    subText.setAttribute("text-anchor", "middle");
    subText.setAttribute("dominant-baseline", "central");
    subText.setAttribute("fill", "#bfb6a3");
    subText.setAttribute("font-size", "8.5");
    subText.setAttribute("transform", `rotate(${centerDeg}, ${subPos.x.toFixed(2)}, ${subPos.y.toFixed(2)})`);
    subText.textContent = shuku.element.charAt(0);
    g.appendChild(subText);

    g.addEventListener("click", () => {
      openShukuQuickDialog(idx);
    });

    outerGroup.appendChild(g);
  });

  // 2. 内周リング（三九の秘法：回転する石盤）
  SANKU_WHEEL_LABELS.forEach((item, idx) => {
    const centerDeg = idx * stepDeg;
    const startDeg = centerDeg - stepDeg / 2;
    const endDeg = centerDeg + stepDeg / 2;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "sanku-sector");
    g.setAttribute("data-offset-idx", String(idx));

    const isMei = item.char === "命";
    const isGyoTai = item.char === "業" || item.char === "胎";
    const isEishin = item.group === "栄親";

    let fillColor = "#1a1622";
    if (isMei) fillColor = "#c93b2b";
    else if (isGyoTai) fillColor = "#3d2963";
    else if (isEishin) fillColor = "#3b3016";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", createSectorPath(166, 96, startDeg, endDeg));
    path.setAttribute("fill", fillColor);
    path.setAttribute("stroke", "#d4af37");
    path.setAttribute("stroke-width", "0.9");
    g.appendChild(path);

    const charPos = polarToCartesian(138, centerDeg);
    const charText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    charText.setAttribute("x", charPos.x.toFixed(2));
    charText.setAttribute("y", charPos.y.toFixed(2));
    charText.setAttribute("text-anchor", "middle");
    charText.setAttribute("dominant-baseline", "central");
    charText.setAttribute("fill", isMei ? "#ffffff" : isEishin ? "#f5d472" : "#e8e0cf");
    charText.setAttribute("font-size", isMei ? "16" : "13.5");
    charText.setAttribute("font-weight", "700");
    charText.setAttribute("transform", `rotate(${centerDeg}, ${charPos.x.toFixed(2)}, ${charPos.y.toFixed(2)})`);
    charText.textContent = item.char;
    g.appendChild(charText);

    const distPos = polarToCartesian(112, centerDeg);
    const distText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    distText.setAttribute("x", distPos.x.toFixed(2));
    distText.setAttribute("y", distPos.y.toFixed(2));
    distText.setAttribute("text-anchor", "middle");
    distText.setAttribute("dominant-baseline", "central");
    distText.setAttribute("fill", isMei ? "#ffe3de" : "#a89f8d");
    distText.setAttribute("font-size", "8");
    distText.setAttribute("transform", `rotate(${centerDeg}, ${distPos.x.toFixed(2)}, ${distPos.y.toFixed(2)})`);
    distText.textContent = item.distance.charAt(0);
    g.appendChild(distText);

    innerGroup.appendChild(g);
  });

  // 中央の九曜紋（中心星＋周囲8星）
  const centerDisk = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  centerDisk.setAttribute("cx", String(cx));
  centerDisk.setAttribute("cy", String(cy));
  centerDisk.setAttribute("r", "94");
  centerDisk.setAttribute("fill", "#120f18");
  centerDisk.setAttribute("stroke", "#d4af37");
  centerDisk.setAttribute("stroke-width", "2");
  innerGroup.appendChild(centerDisk);

  const sunCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  sunCircle.setAttribute("cx", String(cx));
  sunCircle.setAttribute("cy", String(cy));
  sunCircle.setAttribute("r", "24");
  sunCircle.setAttribute("fill", "#d4af37");
  innerGroup.appendChild(sunCircle);

  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 * Math.PI) / 180;
    const sx = cx + 52 * Math.cos(angle);
    const sy = cy + 52 * Math.sin(angle);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", sx.toFixed(2));
    dot.setAttribute("cy", sy.toFixed(2));
    dot.setAttribute("r", "10");
    dot.setAttribute("fill", "#d4af37");
    innerGroup.appendChild(dot);
  }

  const centerLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  centerLabel.setAttribute("x", String(cx));
  centerLabel.setAttribute("y", String(cy));
  centerLabel.setAttribute("text-anchor", "middle");
  centerLabel.setAttribute("dominant-baseline", "central");
  centerLabel.setAttribute("fill", "#161108");
  centerLabel.setAttribute("font-size", "11");
  centerLabel.setAttribute("font-weight", "900");
  centerLabel.textContent = "九曜";
  innerGroup.appendChild(centerLabel);

  setupWheelDragInteraction(innerGroup);
}

/**
 * 内盤をマウスやタッチで直接クルクル回せるインタラクション
 */
function setupWheelDragInteraction(innerGroup) {
  const svg = document.getElementById("senban-svg");
  if (!svg) return;

  let isDragging = false;
  let startAngle = 0;
  let initialWheelDeg = 0;

  const getPointerAngle = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
  };

  innerGroup.addEventListener("pointerdown", (e) => {
    isDragging = true;
    innerGroup.classList.add("dragging");
    innerGroup.setPointerCapture(e.pointerId);
    startAngle = getPointerAngle(e.clientX, e.clientY);
    initialWheelDeg = state.wheelRotationDeg;
  });

  innerGroup.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const currentAngle = getPointerAngle(e.clientX, e.clientY);
    const delta = currentAngle - startAngle;
    const nextDeg = initialWheelDeg + delta;
    state.wheelRotationDeg = nextDeg;
    innerGroup.style.rotate = `${nextDeg.toFixed(2)}deg`;
  });

  const finishDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    innerGroup.classList.remove("dragging");
    const stepDeg = 360 / 27;
    const snappedSteps = Math.round(state.wheelRotationDeg / stepDeg);
    state.wheelRotationDeg = snappedSteps * stepDeg;
    innerGroup.style.rotate = `${state.wheelRotationDeg.toFixed(2)}deg`;
  };

  innerGroup.addEventListener("pointerup", finishDrag);
  innerGroup.addEventListener("pointercancel", finishDrag);
}

/**
 * 自分の宿星の位置に内盤の「命」を回転させて合わせ、2人の星をハイライトする
 */
function alignWheelToPair(selfShukuIdx, partnerShukuIdx) {
  const innerGroup = document.getElementById("inner-sanku-wheel");
  if (!innerGroup) return;

  const stepDeg = 360 / 27;
  const targetDeg = selfShukuIdx * stepDeg;

  let diff = ((targetDeg - state.wheelRotationDeg) % 360 + 540) % 360 - 180;
  state.wheelRotationDeg = state.wheelRotationDeg + diff;
  innerGroup.style.rotate = `${state.wheelRotationDeg.toFixed(2)}deg`;

  document.querySelectorAll(".shuku-sector").forEach((el) => {
    const idx = Number(el.getAttribute("data-shuku-idx"));
    const bg = el.querySelector(".shuku-sector-bg");
    if (!bg) return;

    if (idx === selfShukuIdx && idx === partnerShukuIdx) {
      bg.setAttribute("fill", "#c93b2b");
      bg.setAttribute("stroke", "#ffffff");
      bg.setAttribute("stroke-width", "2.5");
    } else if (idx === selfShukuIdx) {
      bg.setAttribute("fill", "#b83227");
      bg.setAttribute("stroke", "#ffd97d");
      bg.setAttribute("stroke-width", "2.5");
    } else if (idx === partnerShukuIdx) {
      bg.setAttribute("fill", "#b5891b");
      bg.setAttribute("stroke", "#ffffff");
      bg.setAttribute("stroke-width", "2.5");
    } else {
      const shuku = SHUKU_27_DATA[idx];
      const dirColorMap = {
        "東方青龍": "#1b4353",
        "北方玄武": "#23293a",
        "西方白虎": "#4a3f28",
        "南方朱雀": "#542323"
      };
      bg.setAttribute("fill", dirColorMap[shuku.direction]);
      bg.setAttribute("stroke", "#d4af37");
      bg.setAttribute("stroke-width", "1");
    }
  });
}

/**
 * 画面全体の再描画
 */
function renderAll() {
  saveMembersToStorage();
  renderMemberChips();
  renderSelectors();
  renderCompatibilitySection();
  renderKifudaSection();
  renderFocusMemberCompatSection();
  renderGroupMatrixSection();
  renderShukuseichoTable();
}

/**
 * 登録メンバーチップ一覧の描画（名前変更✏️・1対全員相性🎯・削除×ボタン付き）
 */
function renderMemberChips() {
  const container = document.getElementById("member-chips-container");
  if (!container) return;
  container.innerHTML = "";

  state.members.forEach((m) => {
    const astro = calculatePersonAstrology(m);
    const chip = document.createElement("div");
    const isSelf = m.id === state.selfId;
    const isPartner = m.id === state.partnerId;

    chip.className = `member-chip ${isSelf ? "selected-self" : ""} ${isPartner ? "selected-partner" : ""}`;

    let roleBadgeHtml = "";
    if (isSelf && isPartner) {
      roleBadgeHtml = `<span class="chip-role-badge self">自分・相手</span>`;
    } else if (isSelf) {
      roleBadgeHtml = `<span class="chip-role-badge self">自分(命)</span>`;
    } else if (isPartner) {
      roleBadgeHtml = `<span class="chip-role-badge partner">相手</span>`;
    }

    chip.innerHTML = `
      ${roleBadgeHtml}
      <strong>${escapeHtml(m.name)}</strong>
      <span class="chip-shuku">${astro.shuku.name}</span>
      <span style="font-size:0.75rem;color:var(--text-muted);">${astro.tonenStar.name}</span>
      <button type="button" class="chip-edit btn-focus-person" title="${escapeHtml(m.name)}さんとメンバー全員の相性のみを表示" aria-label="${escapeHtml(m.name)}さんとメンバーの相性を表示">🎯</button>
      <button type="button" class="chip-edit btn-edit-person" title="名前や生年月日を変更" aria-label="${escapeHtml(m.name)}さんの情報を変更">✏️</button>
      <button type="button" class="chip-delete" title="削除" aria-label="${escapeHtml(m.name)}を削除">×</button>
    `;

    // チップ本体クリック：現在のモードに合わせて選択対象を切り替え
    chip.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      state.singleTargetId = m.id;
      state.focusMemberId = m.id;
      if (state.selfId !== m.id) {
        state.partnerId = m.id;
      }
      renderAll();
    });

    // 🎯ボタン：その人とメンバー全員の相性のみ表示へ切り替え
    chip.querySelector(".btn-focus-person").addEventListener("click", (e) => {
      e.stopPropagation();
      state.selfId = m.id;
      state.singleTargetId = m.id;
      state.focusMemberId = m.id;
      state.matrixViewMode = "focus";
      updateMatrixModeUI();
      switchTab("tab-matrix");
      renderAll();
      showToast(`「${m.name}」さんとメンバー全員の相性を表示中`);
    });

    // ✏️ボタン：名前・生年月日の変更モーダルを開く
    chip.querySelector(".btn-edit-person").addEventListener("click", (e) => {
      e.stopPropagation();
      openEditMemberDialog(m.id);
    });

    // ×ボタン：削除
    chip.querySelector(".chip-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      removeMember(m.id);
    });

    container.appendChild(chip);
  });
}

/**
 * セレクトボックス（自分・相手・個人診断対象・1対全員基準）の同期
 */
function renderSelectors() {
  const selfSelect = document.getElementById("self-member-select");
  const partnerSelect = document.getElementById("partner-member-select");
  const singleSelect = document.getElementById("single-member-select");
  const focusSelect = document.getElementById("focus-member-select");

  const optionsHtml = state.members
    .map((m) => {
      const astro = calculatePersonAstrology(m);
      return `<option value="${m.id}">${escapeHtml(m.name)}（${astro.shuku.name} / ${m.birthdate}）</option>`;
    })
    .join("");

  if (selfSelect) {
    selfSelect.innerHTML = optionsHtml;
    if (state.selfId) selfSelect.value = state.selfId;
  }
  if (partnerSelect) {
    partnerSelect.innerHTML = optionsHtml;
    if (state.partnerId) partnerSelect.value = state.partnerId;
  }
  if (singleSelect) {
    singleSelect.innerHTML = optionsHtml;
    if (state.singleTargetId) singleSelect.value = state.singleTargetId;
  }
  if (focusSelect) {
    focusSelect.innerHTML = optionsHtml;
    if (!state.focusMemberId) state.focusMemberId = state.selfId || state.members[0]?.id || null;
    if (state.focusMemberId) focusSelect.value = state.focusMemberId;
  }
}

/**
 * 1対1の九曜星占盤＆相性診断結果の描画（結婚相性・アプローチ法付き）
 */
function renderCompatibilitySection() {
  const resultBox = document.getElementById("compat-result-container");
  if (!resultBox) return;

  const selfMember = state.members.find((m) => m.id === state.selfId) || state.members[0];
  const partnerMember = state.members.find((m) => m.id === state.partnerId) || state.members[1] || state.members[0];

  if (!selfMember || !partnerMember) {
    resultBox.innerHTML = `<p>上に自分と友達の名前・生年月日を登録すると、九曜星占盤で相性を占えます。</p>`;
    return;
  }

  const selfAstro = calculatePersonAstrology(selfMember);
  const partnerAstro = calculatePersonAstrology(partnerMember);
  const compat = calculateCompatibility(selfAstro.shukuIndex, partnerAstro.shukuIndex);

  alignWheelToPair(selfAstro.shukuIndex, partnerAstro.shukuIndex);

  const wheelStatus = document.getElementById("wheel-pair-status");
  if (wheelStatus) {
    wheelStatus.innerHTML = `
      <strong>${escapeHtml(selfMember.name)}</strong>の宿星【<strong>${selfAstro.shuku.name}</strong>】に赤字の「<strong>命</strong>」を合わせると、<br>
      <strong>${escapeHtml(partnerMember.name)}</strong>の宿星【<strong>${partnerAstro.shuku.name}</strong>】の位置には「<strong style="color:var(--gold-bright);font-size:1.1rem;">${compat.selfToPartner.char}（${compat.distanceKey}）</strong>」が現れます。
    `;
  }

  resultBox.innerHTML = `
    <div class="compat-header-banner">
      <div>
        <span class="compat-badge">${compat.groupInfo.badge} ・ ${compat.distanceInfo.label}</span>
        <h3 class="compat-main-title">${compat.groupInfo.title}</h3>
      </div>
      <div class="compat-score-circle" title="相性指数">
        <span class="compat-score-num">${compat.score}</span>
        <span class="compat-score-label">相性点</span>
      </div>
    </div>

    <div class="direction-boxes">
      <div class="dir-box">
        <div>
          <div style="font-size:0.76rem;color:var(--text-muted);">${escapeHtml(selfMember.name)}（${selfAstro.shuku.name}）から見た相手</div>
          <div style="font-weight:700;font-size:1rem;margin-top:0.15rem;">
            「${compat.selfToPartner.char}（${compat.selfToPartner.reading}）」の相手
          </div>
          <div style="font-size:0.74rem;color:var(--gold-bright);margin-top:0.2rem;">
            🏯 ${(selfAstro.shuku.historicalFigures || "").split("】")[0]}】
          </div>
        </div>
        <div class="dir-char-seal">${compat.selfToPartner.char}</div>
      </div>

      <div class="dir-box">
        <div>
          <div style="font-size:0.76rem;color:var(--text-muted);">${escapeHtml(partnerMember.name)}（${partnerAstro.shuku.name}）から見たあなた</div>
          <div style="font-weight:700;font-size:1rem;margin-top:0.15rem;">
            「${compat.partnerToSelf.char}（${compat.partnerToSelf.reading}）」の相手
          </div>
          <div style="font-size:0.74rem;color:var(--gold-bright);margin-top:0.2rem;">
            🏯 ${(partnerAstro.shuku.historicalFigures || "").split("】")[0]}】
          </div>
        </div>
        <div class="dir-char-seal" style="background:#8f6b18;">${compat.partnerToSelf.char}</div>
      </div>
    </div>

    <div class="compat-details-grid">
      <div class="compat-detail-item">
        <h4>🔮 二人の宿縁・基本相性</h4>
        <p>${compat.groupInfo.summary}</p>
        <p style="margin-top:0.45rem;font-size:0.84rem;color:var(--text-muted);">
          <strong>【距離感：${compat.distanceInfo.label}】</strong> ${compat.distanceInfo.text}
        </p>
      </div>

      <div class="compat-detail-item">
        <h4>🤝 友達・遊び仲間としての相性</h4>
        <p>${compat.groupInfo.friendship}</p>
      </div>

      <div class="compat-detail-item">
        <h4>❤️ 恋愛・交際での相性</h4>
        <p>${compat.groupInfo.romance}</p>
      </div>

      <div class="compat-detail-item" style="border-left-color:#e6a8d7;">
        <h4>💍 結婚・夫婦としての相性</h4>
        <p>${compat.groupInfo.marriage}</p>
      </div>

      <div class="compat-detail-item" style="border-left-color:var(--jade);background:rgba(47, 158, 111, 0.1);">
        <h4>🌱 【IF】もしも二人の良きところを伸ばし合えたら（歴史上の関係例え）</h4>
        <p style="margin-bottom:0.4rem;">${compat.groupInfo.ifBestCase || ""}</p>
        <p style="font-size:0.85rem;color:var(--gold-bright);">🏯 ${compat.groupInfo.historicalPair || ""}</p>
      </div>

      <div class="compat-detail-item" style="border-left-color:var(--vermilion);background:rgba(209, 59, 44, 0.13);">
        <h4>⚠️ ここがダメになると崩れる（二人の要注意ポイント）</h4>
        <p>${compat.groupInfo.dangerCompat || ""}</p>
      </div>

      <div class="compat-detail-item" style="border-left-color:var(--gold-bright);background:rgba(212, 175, 55, 0.08);">
        <h4>💌 ${escapeHtml(partnerMember.name)}さん（${partnerAstro.shuku.name}）への効果的なアプローチ方法</h4>
        <p style="margin-bottom:0.4rem;"><strong>【二人の関係性からのアプローチ】</strong><br>${compat.groupInfo.approachTip}</p>
        <p><strong>【${partnerAstro.shuku.name}の心を掴む攻略法】</strong><br>${partnerAstro.shuku.targetApproach}</p>
      </div>

      <div class="compat-detail-item">
        <h4>💼 仕事・チームでの相性</h4>
        <p>${compat.groupInfo.work}</p>
      </div>

      <div class="compat-detail-item" style="border-left-color:var(--vermilion-soft);background:rgba(209, 59, 44, 0.1);">
        <h4>⛩️ 満正寺流・二人の開運アドバイス</h4>
        <p>${compat.groupInfo.advice}</p>
      </div>
    </div>
  `;
}

/**
 * 個人の「星札（黄札）」・結婚相手・アプローチ法 ＆ 九曜星診断セクションの描画
 */
function renderKifudaSection() {
  const kifudaBox = document.getElementById("kifuda-card-container");
  const kuyoBox = document.getElementById("kuyosei-detail-container");
  if (!kifudaBox || !kuyoBox) return;

  const targetMember =
    state.members.find((m) => m.id === state.singleTargetId) ||
    state.members.find((m) => m.id === state.selfId) ||
    state.members[0];

  if (!targetMember) {
    kifudaBox.innerHTML = `<p>メンバーを登録してください。</p>`;
    kuyoBox.innerHTML = "";
    return;
  }

  const astro = calculatePersonAstrology(targetMember);
  const { shuku, tonenStar, honmeiStar } = astro;
  const bestMarriageList = getBestMarriageShukuList(astro.shukuIndex, targetMember.id);

  const bestShukuBadgesHtml = bestMarriageList
    .map((item) => {
      const hasFriend = item.matchedFriends.length > 0;
      const friendNote = hasFriend ? `（★${escapeHtml(item.matchedFriends.join("・"))}）` : "";
      return `
        <button
          type="button"
          class="best-shuku-pill ${hasFriend ? "has-friend" : ""}"
          data-shuku-idx="${item.shukuIndex}"
          title="${item.reason} ― クリックで${item.shuku.name}の詳細を見る"
        >
          <span>${item.shuku.name}</span>
          <span style="font-size:0.72rem;opacity:0.85;">[${item.reason.split("（")[0]}]${friendNote}</span>
        </button>
      `;
    })
    .join("");

  kifudaBox.innerHTML = `
    <div class="kifuda-talisman">
      <div class="kifuda-top-stamp">
        <div class="kifuda-temple-label">九曜星占盤 宿星開運札</div>
        <h3 class="kifuda-shuku-title">${shuku.name}</h3>
        <div class="kifuda-shuku-reading">（${shuku.reading}）</div>
        <div class="kifuda-meta-tags">
          <span class="kifuda-tag">${shuku.direction}</span>
          <span class="kifuda-tag">七曜：${shuku.element}</span>
          <span class="kifuda-tag">性質：${shuku.nature}</span>
        </div>
        <div style="margin-top:0.55rem;font-size:0.8rem;font-family:sans-serif;color:#4a3510;">
          <strong>${escapeHtml(targetMember.name)}</strong> 様（${targetMember.birthdate} 生 ／ ${astro.lookupLabel}）
        </div>
      </div>

      <div class="kifuda-catchphrase">
        「${shuku.catchphrase}」
      </div>

      <div class="kifuda-section">
        <h4>【本 質 ・ 性 格（良きところ）】</h4>
        <p>${shuku.personality}</p>
      </div>

      <div class="kifuda-section">
        <h4>【才 能 ・ 適 職】</h4>
        <p>${shuku.talent}</p>
      </div>

      <div class="kifuda-section" style="background:rgba(47, 158, 111, 0.12);padding:0.65rem;border-radius:6px;">
        <h4>🌱 【もしも良きところを伸ばし切ったら（IF・歴史上の人物例え）】</h4>
        <p style="margin-bottom:0.35rem;">${shuku.ifPotential || ""}</p>
        <p style="font-size:0.84rem;color:#4a3510;"><strong>🏯 ${shuku.historicalFigures || ""}</strong></p>
      </div>

      <div class="kifuda-section" style="background:rgba(181, 36, 24, 0.12);padding:0.7rem;border:1px solid #b52418;border-radius:6px;">
        <h4>⚡ 【開運の戒め（ダメなところ・陥りやすい弱点）】</h4>
        <p style="font-weight:700;color:#4a100a;">${shuku.admonition}</p>
      </div>

      <div class="kifuda-section">
        <h4>【健 康 ・ 養 生】</h4>
        <p>${shuku.health}</p>
      </div>

      <div class="kifuda-section">
        <h4>【守 護 開 運 物】</h4>
        <p>${shuku.luckyItem}</p>
      </div>
    </div>
  `;

  const cycleRowsHtml = [];
  for (let offset = -1; offset <= 7; offset++) {
    const y = state.targetYear + offset;
    const age = Math.max(1, y - astro.effectiveBirthYear + 1);
    const mod = ((age % 9) + 9) % 9;
    const star = KUYOSEI_TONEN_DATA[mod];
    const isCurrent = offset === 0;
    cycleRowsHtml.push(`
      <tr class="${isCurrent ? "current-year-row" : ""}">
        <td>${y}年${isCurrent ? "（今年）" : ""}</td>
        <td>数え ${age}歳</td>
        <td><strong style="color:${star.color === "#c93b2b" ? "#ff8a7a" : "var(--gold-bright)"};">${star.name}</strong></td>
        <td>${star.fortune}</td>
      </tr>
    `);
  }

  kuyoBox.innerHTML = `
    <!-- 結婚観・理想の結婚相手・アプローチ法カード -->
    <div class="kuyo-box-card" style="border-color:var(--gold-bright);">
      <h3 style="margin:0 0 0.85rem;color:var(--gold-bright);font-size:1.18rem;">
        💍 ${escapeHtml(targetMember.name)}さん（${shuku.name}）の結婚診断 ＆ 恋のアプローチ法
      </h3>

      <div class="compat-details-grid">
        <div class="compat-detail-item" style="border-left-color:#e6a8d7;">
          <h4>🏡 結婚観・結婚後の家庭運</h4>
          <p>${shuku.marriageView}</p>
        </div>

        <div class="compat-detail-item" style="border-left-color:var(--gold-bright);">
          <h4>💑 どういう人が結婚に合っているか（理想の相手像）</h4>
          <p>${shuku.idealPartner}</p>
          <div style="margin-top:0.65rem;font-size:0.82rem;color:var(--text-muted);">
            <strong>✨ 宿曜で結婚相性が最高な宿星（栄・親／業・胎）：</strong>
            <div class="best-shuku-badges">${bestShukuBadgesHtml}</div>
          </div>
        </div>

        <div class="compat-detail-item" style="border-left-color:var(--jade);">
          <h4>💌 ${escapeHtml(targetMember.name)}さんが好きな人へアプローチする時の秘訣</h4>
          <p>${shuku.selfApproach}</p>
        </div>

        <div class="compat-detail-item" style="border-left-color:var(--vermilion-soft);background:rgba(209, 59, 44, 0.1);">
          <h4>💘 ${escapeHtml(targetMember.name)}さん（${shuku.name}）を振り向かせたい時の攻略法</h4>
          <p>${shuku.targetApproach}</p>
        </div>
      </div>
    </div>

    <!-- 九曜星（当年星・本命星）カード -->
    <div class="kuyo-box-card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
        <h3 style="margin:0;color:var(--gold-bright);font-size:1.15rem;">
          🌟 ${escapeHtml(targetMember.name)}さんの九曜星（当年星・本命星）
        </h3>
        <div style="font-family:sans-serif;font-size:0.82rem;color:var(--text-muted);">
          ${state.targetYear}年（数え年 ${astro.kazoeAge}歳）
        </div>
      </div>

      <div class="tonen-hero">
        <div class="tonen-orb" style="background:${tonenStar.color};">
          <span style="font-size:1.15rem;">${tonenStar.name}</span>
          <span style="font-size:0.65rem;opacity:0.9;">当年星</span>
        </div>
        <div style="flex:1;min-width:220px;font-family:sans-serif;">
          <div style="font-size:0.8rem;color:var(--gold-bright);font-weight:700;">
            ${state.targetYear}年の廻り星（当年星）：${tonenStar.name}（${tonenStar.reading}）
          </div>
          <div style="font-size:1.05rem;font-weight:700;margin:0.15rem 0 0.35rem;">
            運勢判定：${tonenStar.fortune}
          </div>
          <p style="margin:0;font-size:0.88rem;color:var(--text-main);">${tonenStar.summary}</p>
        </div>
      </div>

      <div class="compat-detail-item" style="font-family:sans-serif;margin-bottom:1rem;">
        <h4>🙏 今年の過ごし方・厄除け開運指針</h4>
        <p>${tonenStar.advice}</p>
      </div>

      <div class="compat-detail-item" style="font-family:sans-serif;border-left-color:var(--indigo);">
        <h4>🧭 生まれ年の本命星（北斗七星 × 九星）</h4>
        <p>
          <strong>本命星：${honmeiStar.hokuto} ／ ${honmeiStar.kyusei}</strong><br>
          <strong>本地仏（守り本尊）：</strong>${honmeiStar.buddha}<br>
          <strong>生まれ持った徳性：</strong>${honmeiStar.trait}
        </p>
      </div>
    </div>

    <div class="kuyo-box-card">
      <h4 style="margin:0 0 0.4rem;color:var(--gold-bright);">📅 九曜星 9年周期バイオリズム（当年星の巡り）</h4>
      <p style="margin:0;font-size:0.82rem;color:var(--text-muted);font-family:sans-serif;">
        九曜星は数え年に応じて9年周期で巡ります。大凶星（羅睺星・火曜星・計都星）の年は無理を避けて充電し、吉星（日曜星・月曜星・木曜星）の年に大きく飛躍しましょう。
      </p>
      <div class="table-scroll-container">
        <table class="cycle-table">
          <thead>
            <tr>
              <th>西暦</th>
              <th>数え年</th>
              <th>巡る九曜星（当年星）</th>
              <th>吉凶・運勢の傾向</th>
            </tr>
          </thead>
          <tbody>
            ${cycleRowsHtml.join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  kuyoBox.querySelectorAll(".best-shuku-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      openShukuQuickDialog(Number(btn.getAttribute("data-shuku-idx")));
    });
  });
}

/**
 * 選んだ1人と他メンバー全員の相性のみを表示するセクション（1対Nフォーカス表示）
 */
function renderFocusMemberCompatSection() {
  const headerEl = document.getElementById("focus-compat-header");
  const gridEl = document.getElementById("focus-compat-grid");
  if (!headerEl || !gridEl) return;

  const focusMember =
    state.members.find((m) => m.id === state.focusMemberId) ||
    state.members.find((m) => m.id === state.selfId) ||
    state.members[0];

  if (!focusMember || state.members.length < 2) {
    headerEl.innerHTML = `<p>2人以上のメンバーを登録すると、選んだ人と他メンバー全員の相性一覧が表示されます。</p>`;
    gridEl.innerHTML = "";
    return;
  }

  const focusAstro = calculatePersonAstrology(focusMember);
  const otherMembers = state.members.filter((m) => m.id !== focusMember.id);

  // 相性スコア順にソート
  const comparisons = otherMembers
    .map((other) => {
      const otherAstro = calculatePersonAstrology(other);
      const compat = calculateCompatibility(focusAstro.shukuIndex, otherAstro.shukuIndex);
      return { other, otherAstro, compat };
    })
    .sort((a, b) => b.compat.score - a.compat.score);

  headerEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.65rem;">
      <div>
        <h3 style="margin:0;color:var(--gold-bright);font-size:1.25rem;">
          🎯 【${escapeHtml(focusMember.name)}（${focusAstro.shuku.name}）】とメンバー全員の相性一覧（${comparisons.length}名）
        </h3>
        <p style="margin:0.25rem 0 0;font-size:0.85rem;color:var(--text-muted);font-family:sans-serif;">
          ${escapeHtml(focusMember.name)}さんの宿星「${focusAstro.shuku.name}」に「命」を合わせたときの、各メンバーとの相性・結婚観・アプローチ法です（相性スコア順）。
        </p>
      </div>
      <button type="button" id="focus-person-kifuda-btn" class="btn-secondary">
        💍 ${escapeHtml(focusMember.name)}さんの結婚観・星札を見る
      </button>
    </div>
  `;

  document.getElementById("focus-person-kifuda-btn")?.addEventListener("click", () => {
    state.singleTargetId = focusMember.id;
    switchTab("tab-kifuda");
    renderAll();
  });

  gridEl.innerHTML = comparisons
    .map(({ other, otherAstro, compat }, idx) => {
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
      return `
        <div class="focus-compat-card">
          <div class="focus-card-header">
            <div>
              <div style="font-size:1.05rem;font-weight:700;color:var(--text-main);">
                ${medal} 対 ${escapeHtml(other.name)} <span style="font-size:0.84rem;color:var(--gold-bright);">（${otherAstro.shuku.name}）</span>
              </div>
              <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.1rem;">
                🏯 ${(otherAstro.shuku.historicalFigures || "").split("】")[0]}】
              </div>
              <div style="font-size:0.8rem;color:var(--gold-bright);margin-top:0.15rem;">
                ${compat.groupInfo.badge} ・ 【${compat.groupKey}（${compat.distanceKey}）】
                ${escapeHtml(focusMember.name)}から見て「<strong>${compat.selfToPartner.char}</strong>」／ 相手から見て「<strong>${compat.partnerToSelf.char}</strong>」
              </div>
            </div>
            <div class="compat-score-circle" style="min-width:58px;height:58px;">
              <span class="compat-score-num" style="font-size:1.25rem;">${compat.score}</span>
              <span class="compat-score-label">点</span>
            </div>
          </div>

          <div class="focus-section-mini">
            <strong>🤝 友達としての相性</strong>
            ${compat.groupInfo.friendship}
          </div>

          <div class="focus-section-mini" style="border-left-color:var(--jade);">
            <strong>🌱 【IF】良きところを伸ばし合えたら（歴史例え）</strong>
            ${compat.groupInfo.ifBestCase || ""}<br>
            <span style="font-size:0.78rem;color:var(--gold-bright);">${compat.groupInfo.historicalPair || ""}</span>
          </div>

          <div class="focus-section-mini" style="border-left-color:var(--vermilion);">
            <strong>⚠️ ダメになりやすい要注意ポイント</strong>
            ${compat.groupInfo.dangerCompat || ""}
          </div>

          <div class="focus-section-mini" style="border-left-color:#e6a8d7;">
            <strong>💍 結婚・恋愛としての相性</strong>
            ${compat.groupInfo.marriage}
          </div>

          <div class="focus-section-mini" style="border-left-color:var(--vermilion-soft);">
            <strong>💌 ${escapeHtml(other.name)}さん（${otherAstro.shuku.name}）へのアプローチ法</strong>
            ${compat.groupInfo.approachTip}
          </div>

          <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:auto;padding-top:0.3rem;">
            <button
              type="button"
              class="btn-secondary btn-view-on-wheel"
              data-self-id="${focusMember.id}"
              data-partner-id="${other.id}"
            >
              ☸️ 九曜星占盤でこの2人を見る →
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  gridEl.querySelectorAll(".btn-view-on-wheel").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selfId = btn.getAttribute("data-self-id");
      state.partnerId = btn.getAttribute("data-partner-id");
      switchTab("tab-wheel");
      renderAll();
    });
  });
}

/**
 * 友達グループ全員の総当たり相性表（マトリクス）＆ベストペアランキングの描画
 */
function renderGroupMatrixSection() {
  const matrixContainer = document.getElementById("group-matrix-container");
  const rankingContainer = document.getElementById("group-ranking-container");
  if (!matrixContainer || !rankingContainer) return;

  if (state.members.length < 2) {
    matrixContainer.innerHTML = `<p>2人以上の友達を登録すると、グループ全員の総当たり相性表とベストペアランキングが表示されます。</p>`;
    rankingContainer.innerHTML = "";
    return;
  }

  const memberAstros = state.members.map((m) => ({
    member: m,
    astro: calculatePersonAstrology(m)
  }));

  const headerCells = memberAstros
    .map(
      ({ member, astro }) =>
        `<th scope="col">${escapeHtml(member.name)}<br><span style="font-size:0.75rem;font-weight:400;">(${astro.shuku.name})</span></th>`
    )
    .join("");

  const bodyRows = memberAstros
    .map(({ member: rowMember, astro: rowAstro }) => {
      const cells = memberAstros
        .map(({ member: colMember, astro: colAstro }) => {
          if (rowMember.id === colMember.id) {
            return `<td style="color:var(--text-muted);background:rgba(0,0,0,0.2);">―</td>`;
          }
          const compat = calculateCompatibility(rowAstro.shukuIndex, colAstro.shukuIndex);
          return `
            <td>
              <button
                type="button"
                class="matrix-cell-btn"
                data-self-id="${rowMember.id}"
                data-partner-id="${colMember.id}"
                title="クリックして2人の詳細相性を円盤で見る"
              >
                <strong style="font-size:1rem;color:${compat.groupInfo.color === "#d69e2e" ? "var(--gold-bright)" : "#fff"};">
                  ${compat.selfToPartner.char}
                </strong>
                <span style="font-size:0.7rem;color:var(--text-muted);">${compat.groupKey}(${compat.distanceKey.charAt(0)})</span>
                <span style="font-size:0.72rem;color:var(--gold-bright);font-weight:700;">${compat.score}点</span>
              </button>
            </td>
          `;
        })
        .join("");

      return `
        <tr>
          <th scope="row" style="text-align:left;white-space:nowrap;">
            ${escapeHtml(rowMember.name)} <span style="font-size:0.75rem;font-weight:400;">(${rowAstro.shuku.name})</span>
          </th>
          ${cells}
        </tr>
      `;
    })
    .join("");

  matrixContainer.innerHTML = `
    <div class="table-scroll-container">
      <table class="matrix-table">
        <thead>
          <tr>
            <th>自分 ＼ 相手</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>
  `;

  matrixContainer.querySelectorAll(".matrix-cell-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selfId = btn.getAttribute("data-self-id");
      state.partnerId = btn.getAttribute("data-partner-id");
      switchTab("tab-wheel");
      renderAll();
    });
  });

  const pairs = [];
  for (let i = 0; i < memberAstros.length; i++) {
    for (let j = i + 1; j < memberAstros.length; j++) {
      const a = memberAstros[i];
      const b = memberAstros[j];
      const compat = calculateCompatibility(a.astro.shukuIndex, b.astro.shukuIndex);
      pairs.push({ a, b, compat });
    }
  }
  pairs.sort((p1, p2) => p2.compat.score - p1.compat.score);

  rankingContainer.innerHTML = pairs
    .map((pair, idx) => {
      const { a, b, compat } = pair;
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
      return `
        <div class="ranking-item" data-self-id="${a.member.id}" data-partner-id="${b.member.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
            <span style="font-weight:700;font-size:0.95rem;">
              ${medal} ${escapeHtml(a.member.name)} × ${escapeHtml(b.member.name)}
            </span>
            <span style="font-weight:700;color:var(--gold-bright);font-size:1rem;">${compat.score}点</span>
          </div>
          <div style="font-size:0.8rem;color:var(--gold-bright);margin-bottom:0.25rem;">
            【${compat.groupKey}・${compat.distanceKey}】 ${a.astro.shuku.name}(${compat.selfToPartner.char}) ⇔ ${b.astro.shuku.name}(${compat.partnerToSelf.char})
          </div>
          <div style="font-size:0.8rem;color:var(--text-muted);">
            ${compat.groupInfo.badge}：クリックして九曜星占盤で詳しく見る →
          </div>
        </div>
      `;
    })
    .join("");

  rankingContainer.querySelectorAll(".ranking-item").forEach((card) => {
    card.addEventListener("click", () => {
      state.selfId = card.getAttribute("data-self-id");
      state.partnerId = card.getAttribute("data-partner-id");
      switchTab("tab-wheel");
      renderAll();
    });
  });
}

/**
 * 宿星帳（12ヶ月×31日 早見表マトリクス）の描画
 */
function renderShukuseichoTable() {
  const container = document.getElementById("shukuseicho-table-container");
  if (!container) return;

  const memberDateMap = new Map();
  state.members.forEach((m) => {
    const [, bm, bd] = m.birthdate.split("-").map(Number);
    const key = `${bm}-${bd}`;
    if (!memberDateMap.has(key)) memberDateMap.set(key, []);
    memberDateMap.get(key).push(m.name);
  });

  const monthHeaders = Array.from({ length: 12 }, (_, i) => `<th scope="col">${i + 1}月</th>`).join("");

  const dayRows = Array.from({ length: 31 }, (_, dIdx) => {
    const day = dIdx + 1;
    const cells = Array.from({ length: 12 }, (_, mIdx) => {
      const month = mIdx + 1;
      const startIdx = SHUKU_START_BY_LUNAR_MONTH[month];
      const shukuIdx = (startIdx + (day - 1)) % 27;
      const shuku = SHUKU_27_DATA[shukuIdx];
      const matchedNames = memberDateMap.get(`${month}-${day}`);
      const isHighlighted = Boolean(matchedNames);

      return `
        <td style="${isHighlighted ? "background:rgba(209,59,44,0.38);border:2px solid var(--gold-bright);" : ""}">
          <button
            type="button"
            class="matrix-cell-btn"
            data-shuku-idx="${shukuIdx}"
            style="padding:0.25rem 0.15rem;background:transparent;"
            title="${month}月${day}日：${shuku.name}（${shuku.reading}）${isHighlighted ? " ★" + matchedNames.join(", ") : ""}"
          >
            <strong style="color:${isHighlighted ? "var(--gold-bright)" : "var(--text-main)"};font-size:0.86rem;">
              ${shuku.short}
            </strong>
            ${isHighlighted ? `<span style="font-size:0.65rem;color:#ffd97d;">★${escapeHtml(matchedNames[0])}</span>` : ""}
          </button>
        </td>
      `;
    }).join("");

    return `
      <tr>
        <th scope="row" style="white-space:nowrap;">${day}日</th>
        ${cells}
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <div class="table-scroll-container" style="max-height:540px;overflow-y:auto;">
      <table class="matrix-table">
        <thead style="position:sticky;top:0;z-index:5;">
          <tr>
            <th>日 ＼ 月</th>
            ${monthHeaders}
          </tr>
        </thead>
        <tbody>
          ${dayRows}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll("button[data-shuku-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openShukuQuickDialog(Number(btn.getAttribute("data-shuku-idx")));
    });
  });
}

/**
 * 円盤上の27宿をクリックしたときのクイック解説ダイアログ (<dialog>)
 */
function openShukuQuickDialog(shukuIdx) {
  const dialog = document.getElementById("shuku-quick-dialog");
  const content = document.getElementById("shuku-dialog-body");
  if (!dialog || !content) return;

  const shuku = SHUKU_27_DATA[shukuIdx];
  const selfMember = state.members.find((m) => m.id === state.selfId) || state.members[0];
  let compatHtml = "";

  if (selfMember) {
    const selfAstro = calculatePersonAstrology(selfMember);
    const compat = calculateCompatibility(selfAstro.shukuIndex, shukuIdx);
    compatHtml = `
      <div style="margin-top:1rem;padding:0.85rem;background:var(--bg-card);border:1px solid var(--border-gold);border-radius:10px;font-family:sans-serif;">
        <div style="font-size:0.8rem;color:var(--text-muted);">
          現在の基準：<strong>${escapeHtml(selfMember.name)}（${selfAstro.shuku.name}）</strong>との相性
        </div>
        <div style="font-size:1.05rem;font-weight:700;color:var(--gold-bright);margin:0.2rem 0;">
          「${compat.selfToPartner.char}」― ${compat.groupInfo.title}（${compat.distanceInfo.label} / ${compat.score}点）
        </div>
        <p style="margin:0;font-size:0.86rem;">${compat.groupInfo.summary}</p>
      </div>
    `;
  }

  content.innerHTML = `
    <div style="border-bottom:1px solid var(--border-gold);padding-bottom:0.65rem;margin-bottom:0.85rem;">
      <span style="font-size:0.78rem;color:var(--gold-bright);">${shuku.direction} ／ 七曜：${shuku.element} ／ ${shuku.nature}</span>
      <h3 style="margin:0.2rem 0;font-size:1.6rem;color:var(--text-main);">${shuku.name}（${shuku.reading}）</h3>
      <div style="color:var(--vermilion-soft);font-weight:700;font-size:0.92rem;">「${shuku.catchphrase}」</div>
    </div>
    <div style="font-family:sans-serif;font-size:0.9rem;display:grid;gap:0.65rem;">
      <div><strong>【基本性格（良きところ）】</strong><br>${shuku.personality}</div>
      <div style="background:rgba(47,158,111,0.14);padding:0.65rem;border-radius:8px;"><strong>🌱 【もしも良きところを伸ばし切ったら（IF・歴史人物例え）】</strong><br>${shuku.ifPotential || ""}<br><span style="font-size:0.84rem;color:var(--gold-bright);">🏯 ${shuku.historicalFigures || ""}</span></div>
      <div style="background:rgba(209,59,44,0.14);padding:0.65rem;border-radius:8px;border-left:3px solid var(--vermilion);"><strong>⚡ 【星札の戒め（ダメなところ・要注意点）】</strong><br>${shuku.admonition}</div>
      <div><strong>【結婚観・合う相手】</strong><br>${shuku.idealPartner}</div>
      <div><strong>【この宿星へのアプローチ攻略法】</strong><br>${shuku.targetApproach}</div>
    </div>
    ${compatHtml}
  `;

  dialog.showModal();
}

/**
 * メンバー編集モーダルを開く
 */
function openEditMemberDialog(memberId) {
  const member = state.members.find((m) => m.id === memberId);
  const dialog = document.getElementById("edit-member-dialog");
  if (!member || !dialog) return;

  document.getElementById("edit-member-id").value = member.id;
  document.getElementById("edit-member-name").value = member.name;
  document.getElementById("edit-member-birth").value = member.birthdate;
  document.getElementById("edit-member-shuku").value =
    typeof member.overrideShukuIndex === "number" ? String(member.overrideShukuIndex) : "";

  dialog.showModal();
}

/**
 * メンバーの追加・更新・削除・永続化・URL共有
 */
function addMember(name, birthdate, overrideShukuIndex = null) {
  const newMember = {
    id: "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    birthdate,
    overrideShukuIndex
  };
  state.members.push(newMember);

  if (!state.selfId) {
    state.selfId = newMember.id;
  } else if (!state.partnerId || state.partnerId === state.selfId) {
    state.partnerId = newMember.id;
  }
  state.singleTargetId = newMember.id;
  state.focusMemberId = newMember.id;
  renderAll();
  const astro = calculatePersonAstrology(newMember);
  showToast(`「${newMember.name}」さん（${astro.shuku.name}）を追加しました`);
}

function updateMember(id, newName, newBirthdate, newOverrideIdx) {
  const target = state.members.find((m) => m.id === id);
  if (!target) return;
  target.name = newName.trim() || target.name;
  target.birthdate = newBirthdate || target.birthdate;
  target.overrideShukuIndex = newOverrideIdx;
  renderAll();
  const astro = calculatePersonAstrology(target);
  showToast(`「${target.name}」さん（${astro.shuku.name}）の情報を更新しました`);
}

function removeMember(id) {
  if (state.members.length <= 1) {
    showToast("最低1人はメンバーを残してください");
    return;
  }
  state.members = state.members.filter((m) => m.id !== id);
  if (state.selfId === id) state.selfId = state.members[0]?.id || null;
  if (state.partnerId === id) state.partnerId = state.members[1]?.id || state.members[0]?.id || null;
  if (state.singleTargetId === id) state.singleTargetId = state.members[0]?.id || null;
  if (state.focusMemberId === id) state.focusMemberId = state.members[0]?.id || null;
  renderAll();
}

function saveMembersToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.members));
    localStorage.setItem(MODE_STORAGE_KEY, state.calcMode);
  } catch (_) {}
}

function loadInitialMembers() {
  if (
    typeof window.__EMBEDDED_CALC_MODE__ === "string" &&
    (window.__EMBEDDED_CALC_MODE__ === "manshoji_table" || window.__EMBEDDED_CALC_MODE__ === "lunar_jp")
  ) {
    state.calcMode = window.__EMBEDDED_CALC_MODE__;
  } else {
    try {
      const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
      if (savedMode === "manshoji_table" || savedMode === "lunar_jp") {
        state.calcMode = savedMode;
      }
    } catch (_) {}
  }

  // URLパラメータ ?members= からの読み込み
  const params = new URLSearchParams(window.location.search);
  const sharedParam = params.get("members");
  if (sharedParam) {
    if (decodeAndApplySharedMembers(sharedParam, false)) {
      return;
    }
  }

  // 埋め込み共有HTMLファイル (window.__EMBEDDED_SHARED_MEMBERS__) からの読み込み
  if (Array.isArray(window.__EMBEDDED_SHARED_MEMBERS__) && window.__EMBEDDED_SHARED_MEMBERS__.length > 0) {
    state.members = window.__EMBEDDED_SHARED_MEMBERS__.map((item, idx) => ({
      id: item.id || "embedded_" + idx + "_" + Date.now(),
      name: String(item.name || item.n || "メンバー"),
      birthdate: String(item.birthdate || item.b || "1995-12-06"),
      overrideShukuIndex:
        typeof item.overrideShukuIndex === "number"
          ? item.overrideShukuIndex
          : typeof item.s === "number"
          ? item.s
          : null
    }));
    state.selfId = state.members[0]?.id || null;
    state.partnerId = state.members[1]?.id || state.members[0]?.id || null;
    state.singleTargetId = state.selfId;
    state.focusMemberId = state.selfId;
    return;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.members = parsed;
        state.selfId = state.members[0]?.id || null;
        state.partnerId = state.members[1]?.id || state.members[0]?.id || null;
        state.singleTargetId = state.selfId;
        state.focusMemberId = state.selfId;
        return;
      }
    }
  } catch (_) {}

  loadSampleMembers(false);
}

function loadSampleMembers(notify = true) {
  state.members = [
    { id: "sample_1", name: "自分（1995/12/6生）", birthdate: "1995-12-06", overrideShukuIndex: null },
    { id: "sample_2", name: "友達A（さくら）", birthdate: "1996-08-24", overrideShukuIndex: null },
    { id: "sample_3", name: "友達B（けんた）", birthdate: "1995-11-03", overrideShukuIndex: null },
    { id: "sample_4", name: "友達C（あおい）", birthdate: "1997-02-18", overrideShukuIndex: null }
  ];
  state.selfId = state.members[0].id;
  state.partnerId = state.members[1].id;
  state.singleTargetId = state.members[0].id;
  state.focusMemberId = state.members[0].id;
  if (notify) {
    renderAll();
    showToast("サンプルメンバーを読み込みました（1995/12/6＝婁宿）");
  }
}

/**
 * 共有コードの生成・デコード・LINE用テキスト生成・単一HTML書き出し
 */
function encodeMembersShareCode() {
  const compact = state.members.map((m) => ({
    n: m.name,
    b: m.birthdate,
    ...(typeof m.overrideShukuIndex === "number" ? { s: m.overrideShukuIndex } : {})
  }));
  return btoa(encodeURIComponent(JSON.stringify(compact)));
}

function decodeAndApplySharedMembers(rawInput, notify = true) {
  if (!rawInput || typeof rawInput !== "string") return false;
  let token = rawInput.trim();

  // URL全体が貼り付けられた場合は ?members= 以降を抽出
  if (token.includes("members=")) {
    const match = token.match(/[?&]members=([^&#\s]+)/);
    if (match && match[1]) {
      token = match[1];
    }
  }

  try {
    const decoded = JSON.parse(decodeURIComponent(atob(token)));
    if (Array.isArray(decoded) && decoded.length > 0) {
      state.members = decoded.map((item, idx) => ({
        id: "shared_" + idx + "_" + Date.now(),
        name: String(item.n || item.name || "メンバー"),
        birthdate: String(item.b || item.birthdate || "1995-12-06"),
        overrideShukuIndex:
          typeof item.s === "number"
            ? item.s
            : typeof item.overrideShukuIndex === "number"
            ? item.overrideShukuIndex
            : null
      }));
      state.selfId = state.members[0]?.id || null;
      state.partnerId = state.members[1]?.id || state.members[0]?.id || null;
      state.singleTargetId = state.selfId;
      state.focusMemberId = state.selfId;
      if (notify) {
        renderAll();
        showToast(`共有コードから ${state.members.length}名のメンバーを読み込みました！`);
      }
      return true;
    }
  } catch (_) {}
  return false;
}

function generateShareSummaryText(targetMemberId) {
  const focusMember =
    state.members.find((m) => m.id === targetMemberId) ||
    state.members.find((m) => m.id === state.focusMemberId) ||
    state.members.find((m) => m.id === state.selfId) ||
    state.members[0];

  if (!focusMember) return "";

  const focusAstro = calculatePersonAstrology(focusMember);
  const otherMembers = state.members.filter((m) => m.id !== focusMember.id);

  const lines = [];
  lines.push("☸️ 【満正寺式・九曜星占盤】相性＆結婚診断結果 ☸️");
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push(`👤 主役：${focusMember.name}（${focusMember.birthdate}生）`);
  lines.push(`🌟 宿星：【${focusAstro.shuku.name}（${focusAstro.shuku.reading}）】`);
  lines.push(`   「${focusAstro.shuku.catchphrase}」`);
  lines.push(`✨ 基本性格（良きところ）：${focusAstro.shuku.personality}`);
  lines.push(`🌱 もし良きところを伸ばしたら（IF）：${focusAstro.shuku.ifPotential || ""}`);
  lines.push(`🏯 歴史人物例え：${focusAstro.shuku.historicalFigures || ""}`);
  lines.push(`⚡ 星札の戒め（ダメなところ）：${focusAstro.shuku.admonition}`);
  lines.push(`🪐 ${state.targetYear}年の九曜星（当年星）：【${focusAstro.tonenStar.name}】（${focusAstro.tonenStar.fortune}）`);
  lines.push(`💍 結婚観：${focusAstro.shuku.marriageView}`);
  lines.push(`💑 合う結婚相手：${focusAstro.shuku.idealPartner}`);
  lines.push(`💘 ${focusMember.name}さんへのアプローチ攻略法：${focusAstro.shuku.targetApproach}`);

  if (otherMembers.length > 0) {
    lines.push("");
    lines.push(`🎯 【${focusMember.name}（${focusAstro.shuku.name}）× メンバー全員の相性ランキング】`);
    const comparisons = otherMembers
      .map((other) => {
        const otherAstro = calculatePersonAstrology(other);
        const compat = calculateCompatibility(focusAstro.shukuIndex, otherAstro.shukuIndex);
        return { other, otherAstro, compat };
      })
      .sort((a, b) => b.compat.score - a.compat.score);

    comparisons.forEach(({ other, otherAstro, compat }, idx) => {
      const medal = idx === 0 ? "🥇1位" : idx === 1 ? "🥈2位" : idx === 2 ? "🥉3位" : `・${idx + 1}位`;
      const otherHistShort = (otherAstro.shuku.historicalFigures || "").split("】")[0] + "】";
      lines.push(
        `${medal} 対 ${other.name}（${otherAstro.shuku.name} ${otherHistShort}）：${compat.score}点 【${compat.groupKey}・${compat.distanceKey}】`
      );
      lines.push(
        `   （${focusMember.name}から見て「${compat.selfToPartner.char}」／${other.name}から見て「${compat.partnerToSelf.char}」）`
      );
      lines.push(`   🤝 友達：${compat.groupInfo.friendship}`);
      lines.push(`   🌱 もし良きところを伸ばし合えたら（IF）：${compat.groupInfo.ifBestCase || ""} ${compat.groupInfo.historicalPair || ""}`);
      lines.push(`   ⚠️ 要注意ポイント：${compat.groupInfo.dangerCompat || ""}`);
      lines.push(`   💍 結婚相性：${compat.groupInfo.marriage}`);
      lines.push(`   💌 アプローチ：${compat.groupInfo.approachTip}`);
    });
  }

  lines.push("");
  lines.push("👥 【登録メンバー宿星 ＆ 歴史偉人タイプ一覧】");
  state.members.forEach((m) => {
    const a = calculatePersonAstrology(m);
    const histTag = (a.shuku.historicalFigures || "").split("】")[0] + "】";
    lines.push(`・${m.name}（${m.birthdate}）：${a.shuku.name} ${histTag} ／ 今年：${a.tonenStar.name}`);
  });

  return lines.join("\n");
}

function openShareDialog(focusOnImport = false) {
  const dialog = document.getElementById("share-dialog");
  if (!dialog) return;

  // file:// プロトコルで開いている場合は注意書きを表示
  const fileNotice = document.getElementById("share-file-protocol-notice");
  if (fileNotice) {
    fileNotice.style.display = window.location.protocol === "file:" ? "block" : "none";
  }

  // だれの結果テキストを作るかのセレクト更新
  const shareMemberSelect = document.getElementById("share-focus-member-select");
  const currentTargetId = state.focusMemberId || state.selfId || state.members[0]?.id;
  if (shareMemberSelect) {
    shareMemberSelect.innerHTML = state.members
      .map((m) => {
        const a = calculatePersonAstrology(m);
        return `<option value="${m.id}">${escapeHtml(m.name)}（${a.shuku.name}）</option>`;
      })
      .join("");
    if (currentTargetId) shareMemberSelect.value = currentTargetId;
  }

  // まとめテキスト生成
  const summaryTextarea = document.getElementById("share-summary-textarea");
  if (summaryTextarea) {
    summaryTextarea.value = generateShareSummaryText(currentTargetId);
  }

  // 共有コードとURLのセット
  const code = encodeMembersShareCode();
  const codeOutput = document.getElementById("share-code-output");
  if (codeOutput) codeOutput.value = code;

  const baseUrl = window.location.href.split("?")[0].split("#")[0];
  const webUrlOutput = document.getElementById("share-url-output");
  if (webUrlOutput) {
    webUrlOutput.value =
      window.location.protocol === "file:"
        ? `※現在パソコン内のファイル(file://)のためURL共有はできません。上の①テキストコピー、または②単一HTML保存をご利用ください`
        : `${baseUrl}?members=${code}`;
  }

  dialog.showModal();

  if (focusOnImport) {
    const codeInput = document.getElementById("share-code-input");
    codeInput?.focus();
  }
}

function downloadStandaloneHtml() {
  try {
    const clone = document.documentElement.cloneNode(true);

    // 開いているダイアログを閉じた状態にする
    clone.querySelectorAll("dialog[open]").forEach((d) => d.removeAttribute("open"));

    // トースト表示クラスをリセット
    const toastEl = clone.querySelector("#toast-banner");
    if (toastEl) toastEl.classList.remove("show");

    // 既存 script / 外部 link タグを除去（1ファイルにすべてクリーンに内包するため）
    clone.querySelectorAll('script, link[rel="stylesheet"]').forEach((el) => el.remove());

    // 動的描画コンテナを一旦空にして起動時にクリーンに再描画させる
    [
      "senban-svg-root",
      "member-chips-container",
      "compat-result-container",
      "kifuda-card-container",
      "kuyosei-detail-container",
      "focus-compat-grid",
      "group-matrix-container",
      "group-ranking-container",
      "shukuseicho-table-container"
    ].forEach((id) => {
      const el = clone.querySelector("#" + id);
      if (el) el.innerHTML = "";
    });

    // 埋め込みデータ＋全スクリプトを1つの <script> として注入
    const embeddedScript = document.createElement("script");
    embeddedScript.textContent = [
      `window.__EMBEDDED_SHARED_MEMBERS__ = ${JSON.stringify(state.members)};`,
      `window.__EMBEDDED_CALC_MODE__ = ${JSON.stringify(state.calcMode)};`,
      `const SHUKU_START_BY_LUNAR_MONTH = ${JSON.stringify(SHUKU_START_BY_LUNAR_MONTH)};`,
      `const SANKU_WHEEL_LABELS = ${JSON.stringify(SANKU_WHEEL_LABELS)};`,
      `const SHUKU_27_DATA = ${JSON.stringify(SHUKU_27_DATA)};`,
      `const KUYOSEI_TONEN_DATA = ${JSON.stringify(KUYOSEI_TONEN_DATA)};`,
      `const HONMEI_NINE_STARS = ${JSON.stringify(HONMEI_NINE_STARS)};`,
      `const COMPATIBILITY_GROUPS = ${JSON.stringify(COMPATIBILITY_GROUPS)};`,
      `const DISTANCE_COMMENTARY = ${JSON.stringify(DISTANCE_COMMENTARY)};`,
      `const __kuyoseiAppBootstrap = ${__kuyoseiAppBootstrap.toString()};`,
      `__kuyoseiAppBootstrap();`
    ].join("\n");

    clone.querySelector("body")?.appendChild(embeddedScript);

    const htmlContent = "<!DOCTYPE html>\n" + clone.outerHTML;
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "満正寺_九曜星占盤_メンバー共有版.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

    showToast("メンバー入りの単一HTMLファイルを保存しました！LINE等で友達に送れます");
  } catch (err) {
    showToast("HTMLファイルの書き出し中にエラーが発生しました");
  }
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-target") === tabId);
  });
  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === tabId);
  });
}

function updateMatrixModeUI() {
  const isFocus = state.matrixViewMode === "focus";
  document.getElementById("mode-focus-only-btn")?.classList.toggle("active", isFocus);
  document.getElementById("mode-all-pairs-btn")?.classList.toggle("active", !isFocus);
  const focusSec = document.getElementById("focus-compat-section");
  const allSec = document.getElementById("all-pairs-section");
  if (focusSec) focusSec.style.display = isFocus ? "block" : "none";
  if (allSec) allSec.style.display = isFocus ? "none" : "block";
}

function showToast(msg) {
  const toast = document.getElementById("toast-banner");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function copyTextWithFallback(text, successMsg) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(successMsg))
      .catch(() => {
        prompt("以下のテキストをコピーしてください：", text);
      });
  } else {
    prompt("以下のテキストをコピーしてください：", text);
  }
}

/**
 * 初期化イベント設定
 */
function initApp() {
  const shukuOptionsHtml =
    `<option value="">早見表から自動算出</option>` +
    SHUKU_27_DATA.map((s) => `<option value="${s.index}">${s.name}（${s.reading}）</option>`).join("");

  const overrideSelect = document.getElementById("member-shuku-override");
  const editOverrideSelect = document.getElementById("edit-member-shuku");
  if (overrideSelect) overrideSelect.innerHTML = shukuOptionsHtml;
  if (editOverrideSelect) editOverrideSelect.innerHTML = shukuOptionsHtml;

  buildSenbanSVG();
  loadInitialMembers();

  const calcModeSelect = document.getElementById("calc-mode-select");
  if (calcModeSelect) {
    calcModeSelect.value = state.calcMode;
    calcModeSelect.addEventListener("change", (e) => {
      state.calcMode = e.target.value;
      renderAll();
      showToast(
        state.calcMode === "manshoji_table"
          ? "満正寺・宿星帳（月×日早見表）方式に切り替えました"
          : "旧暦換算方式に切り替えました"
      );
    });
  }

  updateMatrixModeUI();
  renderAll();

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.getAttribute("data-target"));
    });
  });

  // メンバー追加フォーム送信
  const addForm = document.getElementById("add-member-form");
  if (addForm) {
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("member-name-input");
      const birthInput = document.getElementById("member-birth-input");
      const overrideVal = overrideSelect?.value;

      if (!nameInput.value.trim() || !birthInput.value) return;

      const overrideIdx = overrideVal !== "" && overrideVal !== undefined ? Number(overrideVal) : null;
      addMember(nameInput.value, birthInput.value, overrideIdx);
      nameInput.value = "";
      if (overrideSelect) overrideSelect.value = "";
    });
  }

  // メンバー編集フォーム送信
  const editDialog = document.getElementById("edit-member-dialog");
  const editForm = document.getElementById("edit-member-form");
  if (editForm) {
    editForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-member-id").value;
      const newName = document.getElementById("edit-member-name").value;
      const newBirth = document.getElementById("edit-member-birth").value;
      const shukuVal = document.getElementById("edit-member-shuku").value;
      const overrideIdx = shukuVal !== "" && shukuVal !== undefined ? Number(shukuVal) : null;

      updateMember(id, newName, newBirth, overrideIdx);
      editDialog?.close();
    });
  }

  document.getElementById("cancel-edit-member-btn")?.addEventListener("click", () => editDialog?.close());
  editDialog?.addEventListener("click", (e) => {
    if (e.target === editDialog) editDialog.close();
  });

  // 個人診断タブからの名前変更ボタン
  document.getElementById("edit-selected-member-btn")?.addEventListener("click", () => {
    const targetId = state.singleTargetId || state.selfId || state.members[0]?.id;
    if (targetId) openEditMemberDialog(targetId);
  });

  // セレクト変更イベント
  document.getElementById("self-member-select")?.addEventListener("change", (e) => {
    state.selfId = e.target.value;
    state.focusMemberId = e.target.value;
    renderAll();
  });

  document.getElementById("partner-member-select")?.addEventListener("change", (e) => {
    state.partnerId = e.target.value;
    renderAll();
  });

  document.getElementById("single-member-select")?.addEventListener("change", (e) => {
    state.singleTargetId = e.target.value;
    renderAll();
  });

  document.getElementById("focus-member-select")?.addEventListener("change", (e) => {
    state.focusMemberId = e.target.value;
    state.selfId = e.target.value;
    renderAll();
  });

  // 1対全員フォーカス表示 vs 全員総当たり表示の切り替えボタン
  document.getElementById("mode-focus-only-btn")?.addEventListener("click", () => {
    state.matrixViewMode = "focus";
    updateMatrixModeUI();
  });

  document.getElementById("mode-all-pairs-btn")?.addEventListener("click", () => {
    state.matrixViewMode = "all";
    updateMatrixModeUI();
  });

  // 円盤下の「この人と他メンバー全員の相性を見る」ボタン
  document.getElementById("jump-focus-from-wheel-btn")?.addEventListener("click", () => {
    state.focusMemberId = state.selfId || state.members[0]?.id;
    state.matrixViewMode = "focus";
    updateMatrixModeUI();
    switchTab("tab-matrix");
    renderAll();
  });

  document.getElementById("swap-pair-btn")?.addEventListener("click", () => {
    const tmp = state.selfId;
    state.selfId = state.partnerId;
    state.partnerId = tmp;
    renderAll();
  });

  document.getElementById("realign-wheel-btn")?.addEventListener("click", () => {
    const selfMember = state.members.find((m) => m.id === state.selfId) || state.members[0];
    const partnerMember = state.members.find((m) => m.id === state.partnerId) || state.members[0];
    if (selfMember && partnerMember) {
      const sAstro = calculatePersonAstrology(selfMember);
      const pAstro = calculatePersonAstrology(partnerMember);
      alignWheelToPair(sAstro.shukuIndex, pAstro.shukuIndex);
      showToast(`${selfMember.name}さんの宿星【${sAstro.shuku.name}】に「命」を合わせました`);
    }
  });

  // 共有・結果送信ダイアログ関連イベント
  const shareDialog = document.getElementById("share-dialog");
  document.getElementById("share-url-btn")?.addEventListener("click", () => openShareDialog(false));
  document.getElementById("import-code-open-btn")?.addEventListener("click", () => openShareDialog(true));
  document.getElementById("close-share-dialog-btn")?.addEventListener("click", () => shareDialog?.close());
  shareDialog?.addEventListener("click", (e) => {
    if (e.target === shareDialog) shareDialog.close();
  });

  document.getElementById("share-focus-member-select")?.addEventListener("change", (e) => {
    const summaryTextarea = document.getElementById("share-summary-textarea");
    if (summaryTextarea) {
      summaryTextarea.value = generateShareSummaryText(e.target.value);
    }
  });

  document.getElementById("copy-summary-text-btn")?.addEventListener("click", () => {
    const summaryTextarea = document.getElementById("share-summary-textarea");
    if (summaryTextarea && summaryTextarea.value) {
      copyTextWithFallback(
        summaryTextarea.value,
        "診断結果まとめテキストをコピーしました！LINEやDiscordにそのまま貼り付けられます"
      );
    }
  });

  document.getElementById("download-standalone-html-btn")?.addEventListener("click", downloadStandaloneHtml);

  document.getElementById("copy-share-code-btn")?.addEventListener("click", () => {
    const codeOutput = document.getElementById("share-code-output");
    if (codeOutput && codeOutput.value) {
      copyTextWithFallback(codeOutput.value, "メンバー共有コードをコピーしました！");
    }
  });

  document.getElementById("apply-share-code-btn")?.addEventListener("click", () => {
    const codeInput = document.getElementById("share-code-input");
    if (!codeInput || !codeInput.value.trim()) {
      showToast("共有コードまたはURLを入力してください");
      return;
    }
    if (decodeAndApplySharedMembers(codeInput.value, true)) {
      codeInput.value = "";
      shareDialog?.close();
    } else {
      showToast("共有コードの形式が正しくありません");
    }
  });

  document.getElementById("copy-web-url-btn")?.addEventListener("click", () => {
    if (window.location.protocol === "file:") {
      showToast("パソコン内ファイル(file://)のため、①診断テキストコピー または ②単一HTML保存をご利用ください");
      return;
    }
    const webUrlOutput = document.getElementById("share-url-output");
    if (webUrlOutput && webUrlOutput.value) {
      copyTextWithFallback(webUrlOutput.value, "Web共有URLをコピーしました！");
    }
  });

  document.getElementById("reset-sample-btn")?.addEventListener("click", () => loadSampleMembers(true));

  const dialog = document.getElementById("shuku-quick-dialog");
  document.getElementById("close-dialog-btn")?.addEventListener("click", () => dialog?.close());
  dialog?.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

}
__kuyoseiAppBootstrap();
