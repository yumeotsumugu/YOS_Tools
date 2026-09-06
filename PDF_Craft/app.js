/* PDF Craft - ローカル完結の静的PDFツール
 * 依存: lib/pdf-lib.min.js (PDFLib) / lib/pdf.min.js (pdfjsLib) / lib/jszip.min.js (JSZip)
 * PDFはブラウザ内でのみ処理され、外部へ送信されません。
 */
'use strict'

const { PDFDocument, degrees } = PDFLib
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'

/* UUID: crypto.randomUUID はセキュアコンテキスト限定 & 一部の旧ブラウザに無いため、
   全ブラウザ・全コンテキストで使える crypto.getRandomValues でフォールバックする。 */
function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID() } catch (_) {}
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'))
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
}

const LARGE_FILE_BYTES = 40 * 1024 * 1024 // 40MB を超えたら警告 (仕様書 4.3)
const HISTORY_LIMIT = 40

const state = {
  pages: [],              // { id, sourceId, sourcePage, rotation, thumbnail }
  files: new Map(),        // sourceId -> { name, size, bytes(Uint8Array) }
  selected: new Set(),
  mode: 'home',
  zoom: 1,
  history: [],
  future: [],
}

const MODES = {
  home:     { title: 'ホーム',      sub: 'PDFを追加して作業を始めます。' },
  merge:    { title: 'PDFを結合',   sub: '複数のPDFを読み込み、順番を整えて1つに結合します。' },
  organize: { title: 'ページを整理', sub: 'ドラッグ＆ドロップで並べ替え・削除・複製・回転ができます。' },
  split:    { title: 'PDFを分割',   sub: '分割位置または一定ページ数を指定して複数のPDFに分けます。' },
  extract:  { title: 'ページを抽出', sub: '選択したページだけを新しいPDFとして書き出します。' },
  rotate:   { title: 'ページを回転', sub: '選択したページ、または対象を指定してまとめて回転します。' },
}

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)
const els = {
  fileInput: $('#fileInput'), dropZone: $('#dropZone'), workspace: $('#workspace'),
  grid: $('#pageGrid'), emptyState: $('#emptyState'), toast: $('#toast'), modeBar: $('#modeBar'),
}

let toastTimer
function toast(message, isError = false) {
  els.toast.textContent = message
  els.toast.className = `toast show${isError ? ' error' : ''}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3400)
}

const formatBytes = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

function saveSnapshot() {
  state.history.push(state.pages.map((page) => ({ ...page })))
  if (state.history.length > HISTORY_LIMIT) state.history.shift()
  state.future = []
}

/* ---------- 読み込み ---------- */

async function loadFiles(fileList) {
  const files = [...fileList].filter(
    (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
  )
  if (!files.length) return toast('PDFファイルを選択してください。', true)

  let loaded = 0
  for (const file of files) {
    if (file.size > LARGE_FILE_BYTES) {
      toast(`「${file.name}」はファイルサイズが大きいため処理に時間がかかる可能性があります。`)
    }
    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise // slice: worker への転送で元配列が detach されるのを防ぐ
      const sourceId = `${file.name}#${uuid()}`
      state.files.set(sourceId, { name: file.name, size: file.size, bytes })
      for (let n = 1; n <= pdf.numPages; n += 1) {
        state.pages.push({
          id: uuid(), sourceId, sourcePage: n, rotation: 0,
          thumbnail: await renderThumbnail(pdf, n),
        })
      }
      loaded += 1
    } catch (error) {
      if (error && error.name === 'PasswordException') {
        toast(`「${file.name}」はパスワードで保護されています。`, true)
      } else if (error && error.name === 'InvalidPDFException') {
        toast(`「${file.name}」を読み込めませんでした。ファイルが破損している可能性があります。`, true)
      } else {
        toast(`「${file.name}」の読み込み中にエラーが発生しました。`, true)
        console.error(error)
      }
    }
  }
  if (loaded) {
    saveSnapshot()
    if (state.mode === 'home') setMode('organize')
    else render()
    toast(`${loaded}件のPDF（合計${state.pages.length}ページ）を読み込みました`)
  }
}

async function renderThumbnail(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 0.55 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.82)
}

/* ---------- 描画 ---------- */

function render() {
  const hasPages = state.pages.length > 0
  els.dropZone.classList.toggle('hidden', hasPages)
  els.workspace.classList.toggle('hidden', !hasPages)
  els.emptyState.classList.toggle('hidden', hasPages)

  $('#pageCount').textContent = `${state.pages.length}ページ`
  $('#selectionCount').textContent = state.selected.size
  $('#undoBtn').disabled = state.history.length < 2
  $('#redoBtn').disabled = state.future.length === 0

  const totalBytes = [...state.files.values()].reduce((sum, f) => sum + f.size, 0)
  const large = totalBytes > LARGE_FILE_BYTES
  $('#statusDot').className = `status-dot${large ? ' warn' : ''}`
  $('#statusText').textContent = hasPages
    ? `${state.files.size}ファイル / ${formatBytes(totalBytes)}${large ? '（大容量：処理に時間がかかる場合があります）' : ''}`
    : '準備完了'

  updateSaveButton()

  const splitBoundaries = state.mode === 'split' ? computeSplitBoundaries() : new Set()
  els.grid.innerHTML = state.pages
    .map((page, index) => {
      const selected = state.selected.has(page.id)
      const name = state.files.get(page.sourceId)?.name ?? 'PDF'
      return `<article class="page-card${selected ? ' selected' : ''}${splitBoundaries.has(index) ? ' split-boundary' : ''}" draggable="true" data-id="${page.id}" style="--rotation:${page.rotation}deg">
        <div class="page-check">${selected ? '✓' : ''}</div>
        <div class="page-tools">
          <button data-act="rotate" title="右へ90°">↷</button>
          <button data-act="duplicate" title="複製">⧉</button>
          <button data-act="delete" title="削除">⌫</button>
        </div>
        <div class="page-image-wrap"><img src="${page.thumbnail}" alt="${index + 1}ページ目" class="page-image"></div>
        <div class="page-label"><span>${String(index + 1).padStart(2, '0')}</span><small>${name}</small></div>
      </article>`
    })
    .join('')

  bindPageEvents()
  updateInspector()
}

function bindPageEvents() {
  $$('.page-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      const actBtn = event.target.closest('[data-act]')
      if (actBtn) { event.stopPropagation(); return handleCardAction(actBtn.dataset.act, card.dataset.id) }
      selectPage(card.dataset.id, event)
    })
    card.addEventListener('dragstart', (event) => {
      card.classList.add('dragging')
      // Firefox は dataTransfer にデータをセットしないとドラッグを開始しない
      try { event.dataTransfer.setData('text/plain', card.dataset.id) } catch (_) {}
      event.dataTransfer.effectAllowed = 'move'
    })
    card.addEventListener('dragend', () => card.classList.remove('dragging'))
    card.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' })
    card.addEventListener('drop', (event) => {
      event.preventDefault()
      const dragId = $('.dragging')?.dataset.id
      const from = state.pages.findIndex((p) => p.id === dragId)
      const to = state.pages.findIndex((p) => p.id === card.dataset.id)
      if (from < 0 || to < 0 || from === to) return
      saveSnapshot()
      const [moved] = state.pages.splice(from, 1)
      state.pages.splice(to, 0, moved)
      render()
    })
  })
}

function selectPage(id, event) {
  if (event.ctrlKey || event.metaKey) {
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id)
  } else if (event.shiftKey && state.selected.size) {
    const anchor = state.pages.findIndex((p) => state.selected.has(p.id))
    const target = state.pages.findIndex((p) => p.id === id)
    for (let i = Math.min(anchor, target); i <= Math.max(anchor, target); i += 1) {
      state.selected.add(state.pages[i].id)
    }
  } else {
    state.selected = new Set([id])
  }
  render()
}

function handleCardAction(act, id) {
  if (act === 'rotate') { rotatePages([id], 90); return }
  if (act === 'duplicate') { duplicatePages([id]); return }
  if (act === 'delete') { deletePages([id]); return }
}

function updateInspector() {
  const selected = state.pages.filter((p) => state.selected.has(p.id))
  const page = selected[0]
  $('#inspectorIndex').textContent = page
    ? `#${String(state.pages.indexOf(page) + 1).padStart(2, '0')}`
    : '—'
  if (!page) {
    $('#inspectorBody').innerHTML = '<div class="inspector-empty">ページを選択すると<br>詳細が表示されます。</div>'
    return
  }
  const file = state.files.get(page.sourceId)
  $('#inspectorBody').innerHTML = `
    <div class="inspector-preview"><img src="${page.thumbnail}" style="transform:rotate(${page.rotation}deg)" alt="プレビュー"></div>
    <dl>
      <div><dt>元ファイル</dt><dd title="${file?.name ?? ''}">${file?.name ?? 'PDF'}</dd></div>
      <div><dt>元ページ</dt><dd>${page.sourcePage}</dd></div>
      <div><dt>現在の位置</dt><dd>${state.pages.indexOf(page) + 1} / ${state.pages.length}</dd></div>
      <div><dt>回転</dt><dd>${page.rotation}°</dd></div>
      <div><dt>選択数</dt><dd>${selected.length}ページ</dd></div>
    </dl>`
}

/* ---------- 編集操作 ---------- */

function targetIds() {
  return state.selected.size ? [...state.selected] : []
}

function rotatePages(ids, amount) {
  if (!ids.length) return toast('回転するページを選択してください。', true)
  saveSnapshot()
  const set = new Set(ids)
  state.pages.forEach((p) => { if (set.has(p.id)) p.rotation = (p.rotation + amount + 360) % 360 })
  render()
  toast(`${ids.length}ページを回転しました`)
}

function duplicatePages(ids) {
  if (!ids.length) return toast('複製するページを選択してください。', true)
  saveSnapshot()
  const set = new Set(ids)
  const next = []
  state.pages.forEach((p) => {
    next.push(p)
    if (set.has(p.id)) next.push({ ...p, id: uuid() })
  })
  state.pages = next
  render()
  toast(`${ids.length}ページを複製しました`)
}

function deletePages(ids) {
  if (!ids.length) return toast('削除するページを選択してください。', true)
  if (ids.length >= state.pages.length) return toast('すべてのページは削除できません。', true)
  saveSnapshot()
  const set = new Set(ids)
  state.pages = state.pages.filter((p) => !set.has(p.id))
  ids.forEach((id) => state.selected.delete(id))
  render()
  toast(`${ids.length}ページを削除しました`)
}

/* 番号入力での選択:  例 "1,3,5-10,15" (仕様書 9 / 17) */
function parsePageSpec(spec, max) {
  const result = new Set()
  for (const chunk of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = chunk.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      let a = +range[1], b = +range[2]
      if (a > b) [a, b] = [b, a]
      for (let i = a; i <= b; i += 1) if (i >= 1 && i <= max) result.add(i)
    } else if (/^\d+$/.test(chunk)) {
      const n = +chunk
      if (n >= 1 && n <= max) result.add(n)
    }
  }
  return result
}

function selectByRange() {
  const spec = prompt('選択するページ番号を入力してください（例: 1,3,5-10,15）')
  if (spec == null) return
  const nums = parsePageSpec(spec, state.pages.length)
  if (!nums.size) return toast('有効なページ番号がありません。', true)
  state.selected = new Set([...nums].map((n) => state.pages[n - 1].id))
  render()
  toast(`${nums.size}ページを選択しました`)
}

/* ---------- 履歴 ---------- */

function undo() {
  if (state.history.length < 2) return
  state.future.push(state.history.pop())
  state.pages = state.history[state.history.length - 1].map((p) => ({ ...p }))
  pruneSelection()
  render()
}

function redo() {
  if (!state.future.length) return
  const next = state.future.pop()
  state.history.push(next)
  state.pages = next.map((p) => ({ ...p }))
  pruneSelection()
  render()
}

function resetAll() {
  if (!state.pages.length) return
  state.selected.clear()
  state.history = [state.pages.map((p) => ({ ...p }))]
  state.future = []
  render()
  toast('編集状態をリセットしました')
}

function pruneSelection() {
  const ids = new Set(state.pages.map((p) => p.id))
  state.selected.forEach((id) => { if (!ids.has(id)) state.selected.delete(id) })
}

/* ---------- モード / モードバー ---------- */

function setMode(mode) {
  state.mode = mode
  $$('#toolNav [data-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode))
  $('#pageTitle').textContent = MODES[mode].title
  $('#pageSubtitle').textContent = MODES[mode].sub
  renderModeBar()
  render()
}

function renderModeBar() {
  if (state.mode === 'split' && state.pages.length) {
    els.modeBar.classList.remove('hidden')
    els.modeBar.innerHTML = `
      <label>分割位置</label>
      <input type="text" id="splitPositions" placeholder="例: 3,7" title="このページの後ろで区切ります">
      <label>または</label>
      <input type="number" id="splitEvery" min="1" placeholder="N" style="width:64px"> <span class="hint">ページごと</span>
      <span class="hint">／ 空欄で「全ページを1枚ずつ」</span>`
    els.modeBar.oninput = () => render()
  } else if (state.mode === 'rotate' && state.pages.length) {
    els.modeBar.classList.remove('hidden')
    els.modeBar.innerHTML = `
      <label>対象</label>
      <select id="rotateTarget">
        <option value="selected">選択ページ</option>
        <option value="all">全ページ</option>
        <option value="odd">奇数ページ</option>
        <option value="even">偶数ページ</option>
      </select>
      <button class="text-btn" data-rot="-90">↶ 左90°</button>
      <button class="text-btn" data-rot="90">↷ 右90°</button>
      <button class="text-btn" data-rot="180">180°</button>
      <button class="text-btn" data-rot="0">回転をリセット</button>`
    els.modeBar.oninput = null
    els.modeBar.onclick = (event) => {
      const btn = event.target.closest('[data-rot]')
      if (!btn) return
      const ids = rotateTargetIds($('#rotateTarget').value)
      if (!ids.length) return toast('対象ページがありません。', true)
      if (btn.dataset.rot === '0') {
        saveSnapshot()
        const set = new Set(ids)
        state.pages.forEach((p) => { if (set.has(p.id)) p.rotation = 0 })
        render()
        toast(`${ids.length}ページの回転をリセットしました`)
      } else {
        rotatePages(ids, +btn.dataset.rot)
      }
    }
  } else {
    els.modeBar.classList.add('hidden')
    els.modeBar.innerHTML = ''
    els.modeBar.oninput = els.modeBar.onclick = null
  }
}

function rotateTargetIds(target) {
  if (target === 'selected') return [...state.selected]
  return state.pages
    .filter((_, i) => target === 'all' || (target === 'odd' ? (i + 1) % 2 === 1 : (i + 1) % 2 === 0))
    .map((p) => p.id)
}

/* 分割の境界インデックス（区切りの「後ろ」= その index の後で切る） */
function computeSplitBoundaries() {
  const total = state.pages.length
  const boundaries = new Set()
  const positions = $('#splitPositions')?.value.trim()
  const every = parseInt($('#splitEvery')?.value, 10)

  if (positions) {
    for (const n of parsePageSpec(positions, total)) if (n < total) boundaries.add(n - 1) // n ページの後 = index n-1 の後
  } else if (every >= 1) {
    for (let i = every; i < total; i += every) boundaries.add(i - 1)
  } else {
    for (let i = 0; i < total - 1; i += 1) boundaries.add(i) // 全ページ 1 枚ずつ
  }
  return boundaries
}

function splitSegments() {
  const boundaries = [...computeSplitBoundaries()].sort((a, b) => a - b)
  const segments = []
  let start = 0
  for (const b of boundaries) { segments.push(state.pages.slice(start, b + 1)); start = b + 1 }
  segments.push(state.pages.slice(start))
  return segments.filter((seg) => seg.length)
}

/* ---------- 書き出し ---------- */

function baseName() {
  const first = state.files.values().next().value
  return (first?.name || 'document').replace(/\.pdf$/i, '')
}

async function buildPdf(pages) {
  const out = await PDFDocument.create()
  const cache = new Map()
  for (const page of pages) {
    const source = state.files.get(page.sourceId)
    if (!cache.has(page.sourceId)) {
      cache.set(page.sourceId, await PDFDocument.load(source.bytes, { ignoreEncryption: true }))
    }
    const [copied] = await out.copyPages(cache.get(page.sourceId), [page.sourcePage - 1])
    if (page.rotation) {
      const base = copied.getRotation().angle || 0
      copied.setRotation(degrees((base + page.rotation) % 360))
    }
    out.addPage(copied)
  }
  return out.save()
}

function downloadBlob(data, filename, type = 'application/pdf') {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([data], { type }))
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

function updateSaveButton() {
  const hasPages = state.pages.length > 0
  const btn = $('#saveBtn')
  const hint = $('#saveHint')
  btn.disabled = !hasPages
  if (!hasPages) { hint.textContent = 'PDFを追加すると保存できます'; btn.textContent = '↓ PDFを保存'; return }

  if (state.mode === 'extract') {
    btn.textContent = '↓ 抽出して保存'
    hint.textContent = state.selected.size ? `${state.selected.size}ページを抽出` : '抽出するページを選択'
    btn.disabled = state.selected.size === 0
  } else if (state.mode === 'split') {
    const n = splitSegments().length
    btn.textContent = '↓ 分割して保存'
    hint.textContent = n > 1 ? `${n}個のPDFに分割（ZIP）` : '分割位置を指定'
    btn.disabled = n < 2
  } else if (state.mode === 'merge') {
    btn.textContent = '↓ 結合して保存'
    hint.textContent = `${state.files.size}ファイル / ${state.pages.length}ページを結合`
  } else {
    btn.textContent = '↓ PDFを保存'
    hint.textContent = `${state.pages.length}ページを編集中`
  }
}

async function save() {
  if (!state.pages.length) return
  const btn = $('#saveBtn')
  btn.disabled = true
  const original = btn.textContent
  btn.textContent = '処理中…'
  try {
    if (state.mode === 'extract') {
      const pages = state.pages.filter((p) => state.selected.has(p.id))
      if (!pages.length) return toast('抽出するページを選択してください。', true)
      downloadBlob(await buildPdf(pages), `${baseName()}_extracted.pdf`)
      toast(`${pages.length}ページを抽出しました`)
    } else if (state.mode === 'split') {
      const segments = splitSegments()
      if (segments.length < 2) return toast('分割位置を指定してください。', true)
      const zip = new JSZip()
      let i = 1
      for (const seg of segments) {
        zip.file(`${baseName()}_${String(i).padStart(3, '0')}.pdf`, await buildPdf(seg))
        i += 1
      }
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `${baseName()}_split.zip`, 'application/zip')
      toast(`${segments.length}個のPDFに分割しました`)
    } else {
      const name = state.mode === 'merge' ? 'merged.pdf' : `${baseName()}_edited.pdf`
      downloadBlob(await buildPdf(state.pages), name)
      toast(`${name} を保存しました`)
    }
  } catch (error) {
    console.error(error)
    toast('PDFの生成中にエラーが発生しました。', true)
  } finally {
    btn.textContent = original
    updateSaveButton()
  }
}

/* ---------- イベント配線 ---------- */

const openPicker = () => els.fileInput.click()
$('#addBtn').onclick = openPicker
$('#openLink').onclick = openPicker
$('#emptyAdd').onclick = openPicker
els.fileInput.onchange = (event) => { loadFiles(event.target.files); event.target.value = '' }

els.dropZone.ondragover = (event) => { event.preventDefault(); els.dropZone.classList.add('drag-active') }
els.dropZone.ondragleave = () => els.dropZone.classList.remove('drag-active')
els.dropZone.ondrop = (event) => {
  event.preventDefault()
  els.dropZone.classList.remove('drag-active')
  loadFiles(event.dataTransfer.files)
}
// ページ追加は一覧表示中でもドロップで受け付ける
document.addEventListener('dragover', (event) => { if (state.pages.length) event.preventDefault() })
document.addEventListener('drop', (event) => {
  if (state.pages.length && event.dataTransfer?.files.length) { event.preventDefault(); loadFiles(event.dataTransfer.files) }
})

$('#selectByRange').onclick = selectByRange
$('#selectAll').onclick = () => { state.selected = new Set(state.pages.map((p) => p.id)); render() }
$('#clearSelection').onclick = () => { state.selected.clear(); render() }
$('#deleteSelected').onclick = () => deletePages(targetIds())

$('#rotateLeft').onclick = () => rotatePages(targetIds(), -90)
$('#rotateRight').onclick = () => rotatePages(targetIds(), 90)
$('#duplicatePage').onclick = () => duplicatePages(targetIds())
$('#extractPage').onclick = () => { setMode('extract'); save() }

$('#saveBtn').onclick = save
$('#undoBtn').onclick = undo
$('#redoBtn').onclick = redo
$('#resetBtn').onclick = resetAll

function setZoom(value) {
  state.zoom = Math.min(1.5, Math.max(0.6, value))
  $('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`
  els.grid.style.transform = state.zoom === 1 ? 'none' : `scale(${state.zoom})`
  els.grid.style.transformOrigin = 'top left'
}
$('#zoomIn').onclick = () => setZoom(state.zoom + 0.1)
$('#zoomOut').onclick = () => setZoom(state.zoom - 0.1)
$('#resetZoom').onclick = () => setZoom(1)

$('#toolNav').onclick = (event) => {
  const btn = event.target.closest('[data-mode]')
  if (btn) setMode(btn.dataset.mode)
}

$('#helpBtn').onclick = () => toast('左のメニューで作業を選び、ページを選択して右下の保存ボタンで書き出します。すべて端末内で処理されます。')

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !typing && state.pages.length) {
    event.preventDefault(); state.selected = new Set(state.pages.map((p) => p.id)); render(); return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && state.selected.size) {
    event.preventDefault(); deletePages([...state.selected])
  }
})

setMode('home')
render()
