import { syncJstreamDefaults, syncStickyDefaultColor } from './annotation-dialog.js';
import { scheduleAutoSave } from './autosave.js';
import { CUSTOM_STICKY_COLOR_BASE, CUSTOM_STICKY_COLOR_SLOTS, CUSTOM_STICKY_COLOR_VALUES } from './config.js';
import { validateJstreamCorpId, validateJstreamDir } from './jstream-validate.js';
import { state } from './state.js';

/* =========================================================
   環境設定モーダル

   - 付箋のデフォルトカラー・大問ボタン作成メニューのラベル文言・
     J-stream動画のデフォルト値（Jストリームディレクトリ／企業ID）を設定する。
   - 設定値は state に保持し、OK押下時に localStorage（SETTINGS_STORAGE_KEY）へ
     永続化する。起動時は main.js が loadSettings() を呼んで復元する。
   ========================================================= */

/** 環境設定の永続化に使う localStorage キー */
const SETTINGS_STORAGE_KEY = 'ContentsBuilderSettings';

/**
 * 付箋デフォルトカラーとして環境設定で選べる値。
 * '3'（紙色）と '100'〜'102'（カスタム1〜3）。旧選択肢 '0'〜'2'（青/緑/黄）は
 * 過去データの描画用に config.js の定義だけを残しており、環境設定からは選べない。
 */
const STICKY_COLOR_VALUES = ['3', ...CUSTOM_STICKY_COLOR_VALUES];

/**
 * カスタムカラーの入力値を '#rrggbb'（小文字）へ正規化する。
 * '#' の有無と大文字小文字を許容し、それ以外は不正として null を返す。
 * @param {string} value
 * @returns {string|null} 正規化した '#rrggbb'、または不正なら null
 */
function normalizeStickyHex(value) {
  const v = String(value ?? '').trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(v);
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** 大問ボタン作成メニューのラベルとして許容する値 */
const DAIMON_LABEL_VALUES = ['大問', 'ALL', '解答'];

/**
 * 環境設定オブジェクト（localStorage の保存形式と同じキー構成）を state へ適用する。
 * 値が壊れている・想定外の場合はその項目を無視し、呼び出し時点の state の値を維持する。
 * @param {*} saved - パース済みの設定オブジェクト。オブジェクトでなければ何もしない
 */
function applySettingsObject(saved) {
  if (!saved || typeof saved !== 'object') return;

  // カスタムカラーはデフォルト色の判定より先に復元する
  // （選ばれているスロットが登録済みかの判断に使うため）。
  // スロット数は常に CUSTOM_STICKY_COLOR_SLOTS 個に揃え、壊れた値・不正なhexは空文字にする。
  if (Array.isArray(saved.customStickyColors)) {
    state.settingsCustomStickyColors = Array.from(
      { length: CUSTOM_STICKY_COLOR_SLOTS },
      (_, i) => normalizeStickyHex(saved.customStickyColors[i]) || ''
    );
  }

  if (saved.stickyDefaultColor !== undefined) {
    const savedMode = String(saved.stickyDefaultColor);
    const slot = CUSTOM_STICKY_COLOR_VALUES.indexOf(savedMode);
    if (slot >= 0 && state.settingsCustomStickyColors[slot]) {
      state.settingsStickyDefaultColor = savedMode;
    } else {
      // 旧選択肢（'0'=青 / '1'=緑 / '2'=黄）や、未登録スロットが選ばれた状態で
      // 保存されていた場合は、選択できる既定値である紙色へ丸める
      state.settingsStickyDefaultColor = '3';
    }
  }
  if (DAIMON_LABEL_VALUES.includes(saved.daimonLabel)) {
    state.settingsDaimonLabel = saved.daimonLabel;
  }
  if (typeof saved.jstreamDir === 'string') {
    state.settingsJstreamDir = saved.jstreamDir;
  }
  if (typeof saved.jstreamCorpId === 'string') {
    state.settingsJstreamCorpId = saved.jstreamCorpId;
  }
}

/**
 * 環境設定の初期値（state.js の定義と一致させること）を新しいオブジェクトで返す。
 * bookに設定が記録されていない場合のリセット先として使う。
 * @returns {Object}
 */
function getDefaultSettings() {
  return {
    stickyDefaultColor: '3',
    customStickyColors: Array.from({ length: CUSTOM_STICKY_COLOR_SLOTS }, () => ''),
    daimonLabel:        '大問',
    jstreamDir:         '',
    jstreamCorpId:      '',
  };
}

/**
 * localStorage に保存された環境設定を state へ復元する（起動時に1度だけ呼ぶ）。
 * 保存値が壊れている・想定外の値の場合はその項目を無視し、state 側の初期値を使う。
 *
 * 注意：book を開くと applyBookSettings() が「初期値 ＋ book値」で state を作り直すため、
 * ここで復元した値が効くのは book 未読込の間だけである。将来 localStorage での管理を
 * 廃止する際は、この関数と saveSettings()・SETTINGS_STORAGE_KEY を削除すればよい。
 */
export function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
  } catch (_) {
    saved = null;
  }
  applySettingsObject(saved);
}

/**
 * LIBRO book の index.json に記録された環境設定を state へ適用し、UIへ反映する。
 * book読込のたびに呼ぶ。
 *
 * - book側に settings があれば、確認なしで無条件に適用する（教材ごとに固定される
 *   Jストリーム設定・大問ボタン文言を自動で切り替えるのが目的のため）。
 * - book側に settings が無ければ初期値へリセットする。前bookの設定も、ブラウザに
 *   溜まった localStorage の既定値も、bookへ持ち込ませないための仕様である。
 * - localStorage は読まないし書き換えもしない（将来の localStorage 廃止に備え、
 *   book由来の設定経路が localStorage へ依存しないようにする）。
 *
 * @param {Object} indexJson - LIBRO book の index.json パース済みオブジェクト
 */
export function applyBookSettings(indexJson) {
  // book固有の設定を適用する前に必ず初期値へ戻してから重ねる。
  // book側が一部の項目しか持たない場合でも、前bookの値が残らない。
  applySettingsObject(getDefaultSettings());

  const bookSettings = indexJson?.configs?.['libro-craft-meta']?.settings;
  if (bookSettings) applySettingsObject(bookSettings);

  syncSettingsToUi();
}

/**
 * state の環境設定をUI・連続作成用の前回設定へ反映する（closeSettingsModal と同じ処理）。
 */
function syncSettingsToUi() {
  syncStickyDefaultColor(state.settingsStickyDefaultColor);
  syncJstreamDefaults(state.settingsJstreamDir, state.settingsJstreamCorpId);
  applyDaimonMenuLabel();
}

/**
 * 現在の state の環境設定を、localStorage・book・一時保存と同じキー構成の新しいオブジェクトで返す。
 * 一時保存（autosave.js）へ環境設定を含めるために使う。
 * @returns {Object}
 */
export function getCurrentSettings() {
  return {
    stickyDefaultColor: state.settingsStickyDefaultColor,
    customStickyColors: [...state.settingsCustomStickyColors],
    daimonLabel:        state.settingsDaimonLabel,
    jstreamDir:         state.settingsJstreamDir,
    jstreamCorpId:      state.settingsJstreamCorpId,
  };
}

/**
 * 一時保存（オートセーブ）に記録された環境設定を state へ適用し、UIへ反映する。
 * 復元を選んだときに、applyBookSettings() の後で呼ぶ（一時保存の方が新しい作業状態のため、
 * bookに記録された値より優先する）。初期値へのリセットはしない。
 * localStorage は読まないし書き換えもしない（applyBookSettings と同じ方針）。
 * @param {Object} saved - 一時保存の settings（getCurrentSettings() と同じキー構成）
 */
export function applyAutoSaveSettings(saved) {
  applySettingsObject(saved);
  syncSettingsToUi();
}

/**
 * 現在の state の環境設定値を localStorage へ保存する。
 * プライベートモード等で localStorage が使えない場合は永続化のみ諦め、
 * セッション内の設定（state）はそのまま有効にする。
 */
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      stickyDefaultColor: state.settingsStickyDefaultColor,
      customStickyColors: state.settingsCustomStickyColors,
      daimonLabel:        state.settingsDaimonLabel,
      jstreamDir:         state.settingsJstreamDir,
      jstreamCorpId:      state.settingsJstreamCorpId,
    }));
  } catch (_) {
    /* 保存できない環境では何もしない */
  }
}

/**
 * 環境設定モーダルで現在選ばれている付箋カラー（'3'=紙色 / '100'〜'102'=カスタム1〜3）を返す。
 * @returns {string}
 */
function getSelectedStickyColorMode() {
  const checked = document.querySelector('#settingsStickyColorMode input[name="settingsStickyColorMode"]:checked');
  return checked ? checked.value : '3';
}

/**
 * カスタムカラー各スロットのhex入力欄・カラーピッカーを取得する。
 * @param {number} slot - 0起点のスロット番号
 * @returns {{picker: HTMLElement, hexEl: HTMLElement}}
 */
function getCustomColorInputs(slot) {
  return {
    picker: document.getElementById(`settingsCustomColorPicker${slot}`),
    hexEl:  document.getElementById(`settingsCustomColorHex${slot}`),
  };
}

/**
 * カスタムカラーの入力値を検証し、設定の反映を続行してよいかを返す。
 * - 空欄のスロットは「未登録」として許容する（削除に相当）。
 * - 空でないスロットは #RRGGBB 形式でなければエラー。
 * - デフォルト色として選択中のスロットが空欄の場合もエラー（色が決まらないため）。
 * エラー時は欄の直下にメッセージを表示し、付箋タブへ切り替えて該当欄へフォーカスする
 * （J-stream欄と同じ方式。確認ダイアログは出さない）。
 * @returns {boolean} true なら反映を続行してよい
 */
function applyStickyColorValidation() {
  const errEl = document.getElementById('settingsCustomColorError');
  const showError = (message, focusEl) => {
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.add('is-shown');
    }
    switchSettingsTab('sticky');
    if (focusEl) focusEl.focus();
  };
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.remove('is-shown');
  }

  // 空でないスロットの形式を検証する
  for (let slot = 0; slot < CUSTOM_STICKY_COLOR_SLOTS; slot++) {
    const { hexEl } = getCustomColorInputs(slot);
    const raw = (hexEl?.value ?? '').trim();
    if (raw === '') continue;
    if (!normalizeStickyHex(raw)) {
      showError(`カスタム${slot + 1}のカラーは #RRGGBB 形式（16進数6桁）で入力してください。`, hexEl);
      return false;
    }
  }

  // デフォルトとして選択中のスロットは未登録であってはならない
  const selectedSlot = CUSTOM_STICKY_COLOR_VALUES.indexOf(getSelectedStickyColorMode());
  if (selectedSlot >= 0) {
    const { hexEl } = getCustomColorInputs(selectedSlot);
    if ((hexEl?.value ?? '').trim() === '') {
      showError(`カスタム${selectedSlot + 1}のカラーを入力してください。`, hexEl);
      return false;
    }
  }
  return true;
}

/**
 * 環境設定のJ-stream入力値を検証し、設定の反映を続行してよいかを返す。
 * 2欄すべてを判定し、エラーの欄には各欄直下のエラー表示欄へメッセージを出す
 * （最初のエラーで打ち切らないため、複数欄が同時にエラー表示になることがある）。
 * エラーがあれば動画再生タブへ切り替え、最初にエラーになった欄へフォーカスして
 * 反映を中止する（確認ダイアログは出さない）。
 * @param {string} dirValue  - トリム済みのJストリームディレクトリ
 * @param {string} corpValue - トリム済みの企業ID
 * @returns {boolean} true なら反映を続行してよい
 */
function applyJstreamValidation(dirValue, corpValue) {
  const targets = [
    ['settingsJstreamDirInput',    'settingsJstreamDirError',    validateJstreamDir(dirValue)],
    ['settingsJstreamCorpIdInput', 'settingsJstreamCorpIdError', validateJstreamCorpId(corpValue)],
  ];
  let firstInvalid = null;
  for (const [inputId, errId, result] of targets) {
    const isError = result.level === 'error';
    const errEl = document.getElementById(errId);
    if (errEl) {
      errEl.textContent = isError ? result.message : '';
      errEl.classList.toggle('is-shown', isError);
    }
    if (isError && !firstInvalid) firstInvalid = document.getElementById(inputId);
  }
  if (firstInvalid) {
    switchSettingsTab('video');
    firstInvalid.focus();
    return false;
  }
  return true;
}

/**
 * 環境設定モーダルを開く。現在のstate値をフォームへ反映してから表示する。
 */
export function openSettingsModal() {
  // 付箋カラー：選択中の色（紙色／カスタム1〜3）と各スロットの入力欄をstate値から復元する。
  // 未登録スロットのhex欄は空にし、ピッカーだけ紙色（#ffffff）を初期表示にする。
  const mode = STICKY_COLOR_VALUES.includes(state.settingsStickyDefaultColor)
    ? state.settingsStickyDefaultColor
    : '3';
  const modeInput = document.querySelector(`#settingsStickyColorMode input[value="${mode}"]`);
  if (modeInput) modeInput.checked = true;
  for (let slot = 0; slot < CUSTOM_STICKY_COLOR_SLOTS; slot++) {
    const { picker, hexEl } = getCustomColorInputs(slot);
    const savedHex = state.settingsCustomStickyColors[slot] || '';
    if (picker) picker.value = savedHex || '#ffffff';
    if (hexEl)  hexEl.value  = savedHex;
  }

  document.getElementById('settingsDaimonLabelSelect').value = state.settingsDaimonLabel;
  document.getElementById('settingsJstreamDirInput').value    = state.settingsJstreamDir;
  document.getElementById('settingsJstreamCorpIdInput').value = state.settingsJstreamCorpId;
  // 前回開いたときのエラー表示は持ち越さない
  ['settingsJstreamDirError', 'settingsJstreamCorpIdError', 'settingsCustomColorError'].forEach(id => {
    const errEl = document.getElementById(id);
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.remove('is-shown');
    }
  });
  document.getElementById('settingsOverlay').classList.add('is-open');
}

/**
 * 環境設定モーダルを閉じる。
 * @param {boolean} save - trueならフォーム値をstateへ反映し、大問ボタン作成メニューのラベルを更新して localStorage へ保存する。
 */
export function closeSettingsModal(save) {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay || !overlay.classList.contains('is-open')) return;

  if (save) {
    // J-streamのデフォルト値は書き出し時にそのまま toMovie の引数となるため、
    // 反映前にJ-Streamの想定入力値かを検証する。想定外の値は反映せず、
    // モーダルを開いたまま該当欄の直下にエラーメッセージを表示する
    // （確認ダイアログは出さない）。空欄（未設定）は常に許容する。
    // 前後の空白は検証・保持のいずれでも除去する（意図しない空白混入を防ぐ）。
    const dirValue  = document.getElementById('settingsJstreamDirInput').value.trim();
    const corpValue = document.getElementById('settingsJstreamCorpIdInput').value.trim();
    if (!applyJstreamValidation(dirValue, corpValue)) return;
    // カスタムカラーは付箋の色そのものになるため、反映前に #RRGGBB 形式かを検証する。
    // 空欄のスロットは「未登録」として許容する（削除に相当）。
    if (!applyStickyColorValidation()) return;

    // 各スロットを反映する。空欄は未登録（空文字）として保存する。
    // 検証済みのため normalizeStickyHex は必ず成功する（空欄を除く）。
    for (let slot = 0; slot < CUSTOM_STICKY_COLOR_SLOTS; slot++) {
      const { hexEl } = getCustomColorInputs(slot);
      const raw = (hexEl?.value ?? '').trim();
      state.settingsCustomStickyColors[slot] = raw === '' ? '' : normalizeStickyHex(raw);
    }
    state.settingsStickyDefaultColor = getSelectedStickyColorMode();
    state.settingsDaimonLabel        = document.getElementById('settingsDaimonLabelSelect').value;
    state.settingsJstreamDir    = dirValue;
    state.settingsJstreamCorpId = corpValue;
    // 連続作成用の前回設定（lastNewAnnData.sticky）の色も新デフォルトへ揃える。
    // これをしないと、既に付箋を作成済みのセッションで設定変更が反映されない。
    syncStickyDefaultColor(state.settingsStickyDefaultColor);
    // 同様に、連続作成用の前回設定（lastNewAnnData.video）のJ-stream値も新デフォルトへ揃える。
    syncJstreamDefaults(state.settingsJstreamDir, state.settingsJstreamCorpId);
    // 付箋の描画モード中は、生成済みのサイドバー色セレクトも新デフォルトへ追従させる。
    // ただしオブジェクト選択中は同じセレクトが「選択中付箋の色編集用」として使われているため、
    // 書き換えると選択中の付箋の色を意図せず変えてしまう。選択中は追従させない。
    const liveColorSel = document.getElementById('annColor');
    const hasSelection = !!document.querySelector('.is-selected');
    if (liveColorSel && state.currentDrawType === 'sticky' && !hasSelection) {
      liveColorSel.value = String(state.settingsStickyDefaultColor);
    }
    applyDaimonMenuLabel();
    saveSettings();
    // 環境設定だけを変えた場合も、中断時に一時保存から戻せるよう保存を予約する
    // （部品の操作が無いと、次の定期保存まで最大30秒反映されないため）
    scheduleAutoSave();
  }

  overlay.classList.remove('is-open');
}

/** サイドバーの大問ボタン作成メニューのラベルを state.settingsDaimonLabel から反映する。 */
export function applyDaimonMenuLabel() {
  const el = document.getElementById('daimonMenuLabel');
  if (el) el.textContent = `${state.settingsDaimonLabel}ボタン`;
}


/**
 * 環境設定モーダルのサイドタブを切り替える。
 * タブ（.settings-tab[data-settings-tab]）と内容ペイン（.settings-pane[data-settings-pane]）を
 * 同じキー文字列で対応付けており、タブを増やす場合はHTML側に対を追加するだけでよい。
 * @param {string} tabKey - data-settings-tab / data-settings-pane の値
 */
function switchSettingsTab(tabKey) {
  document.querySelectorAll('#settingsOverlay .settings-tab').forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.settingsTab === tabKey);
  });
  document.querySelectorAll('#settingsOverlay .settings-pane').forEach(pane => {
    pane.classList.toggle('is-active', pane.dataset.settingsPane === tabKey);
  });
}


/**
 * サイドタブのクリックハンドラを設定する（初期化時に1度だけ呼ぶ）。
 * タブコンテナへのイベント委譲にしてあるため、将来タブを追加しても配線の変更は不要。
 */
export function initSettingsTabs() {
  const tabs = document.getElementById('settingsTabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-tab');
    if (!btn || !btn.dataset.settingsTab) return;
    switchSettingsTab(btn.dataset.settingsTab);
  });
}


/**
 * 環境設定の付箋カラー欄（カラーピッカーとhex手入力の相互同期）を配線する
 * （初期化時に1度だけ呼ぶ）。スロットごとに同じ配線を行う。
 * - ピッカー操作：同じスロットのhex欄へ反映し、そのスロットのラジオも選択状態にする
 *   （色をいじった枠をそのままデフォルトにしたい、という自然な操作に合わせる）
 * - hex欄入力：正規化できた場合のみピッカーへ反映する（不正値の判定はOK押下時に行う）
 * ラジオ自体は選択されるだけで、追加の配線は不要（値は closeSettingsModal(true) 時に読む）。
 */
export function initStickyColorControls() {
  const modeWrap = document.getElementById('settingsStickyColorMode');
  if (!modeWrap) return;
  const errEl = document.getElementById('settingsCustomColorError');
  const clearError = () => {
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.remove('is-shown');
    }
  };

  for (let slot = 0; slot < CUSTOM_STICKY_COLOR_SLOTS; slot++) {
    const { picker, hexEl } = getCustomColorInputs(slot);
    if (!picker || !hexEl) continue;
    const radio = modeWrap.querySelector(`input[value="${CUSTOM_STICKY_COLOR_VALUES[slot]}"]`);

    picker.addEventListener('input', () => {
      hexEl.value = picker.value;
      if (radio) radio.checked = true;
      clearError();
    });

    hexEl.addEventListener('input', () => {
      const hex = normalizeStickyHex(hexEl.value);
      if (hex) picker.value = hex;
    });
  }
}
