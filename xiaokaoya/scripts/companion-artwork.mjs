import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Original, layered vector drawings. Classes expose only the parts that should move.
const animals = {
  duck: { fill: '#ffe6a0', belly: '#fff4d1', accent: '#d6ab61' },
  cat: { fill: '#f3cbaa', belly: '#fff2df', accent: '#c89471' },
  bear: { fill: '#c9a88b', belly: '#f5e2c9', accent: '#ad8262' },
  rabbit: { fill: '#fff5ed', belly: '#fffaf5', accent: '#e3b6b8' },
  dog: { fill: '#eed3ac', belly: '#fff1dc', accent: '#b88e6f' },
}
const outline = '#856c57'
const eyes = '#665445'
const openEyes = (study) =>
  `<g class="pet-eyes-open"><ellipse cx="135" cy="${study ? 115 : 111}" rx="3.5" ry="4.6" fill="${eyes}" stroke="none"/><ellipse cx="185" cy="${study ? 115 : 111}" rx="3.5" ry="4.6" fill="${eyes}" stroke="none"/><circle cx="136" cy="${study ? 113 : 109}" r="1.1" fill="#fffdf7" stroke="none"/><circle cx="186" cy="${study ? 113 : 109}" r="1.1" fill="#fffdf7" stroke="none"/></g>`
const closedEyes = '<path d="M127 113q7 7 15 0m35 0q7 7 15 0" fill="none" stroke-width="2.6"/>'

function ears(id, p) {
  if (id === 'cat')
    return `<path d="m106 94-4-39q0-10 9-5l25 25m48 0 25-25q9-5 9 5l-4 39" fill="${p.fill}"/><path d="m112 66 3 20 12-9m65 0 12 9 3-20" fill="#e9b4a0" stroke="none"/>`
  if (id === 'rabbit')
    return `<ellipse cx="132" cy="52" rx="14" ry="39" fill="${p.fill}" transform="rotate(-10 132 52)"/><ellipse cx="186" cy="51" rx="14" ry="40" fill="${p.fill}" transform="rotate(10 186 51)"/><ellipse cx="132" cy="52" rx="5.5" ry="27" fill="#ecc8c6" stroke="none" transform="rotate(-10 132 52)"/><ellipse cx="186" cy="51" rx="5.5" ry="28" fill="#ecc8c6" stroke="none" transform="rotate(10 186 51)"/>`
  if (id === 'bear')
    return `<circle cx="115" cy="74" r="20" fill="${p.fill}"/><circle cx="205" cy="74" r="20" fill="${p.fill}"/><circle cx="115" cy="74" r="10.5" fill="${p.belly}" stroke="none"/><circle cx="205" cy="74" r="10.5" fill="${p.belly}" stroke="none"/>`
  if (id === 'dog')
    return `<path d="M114 79q-22-17-28 8-5 17 1 42 3 12 14 9 12-5 18-37m87-22q22-17 28 8 5 17-1 42-3 12-14 9-12-5-18-37" fill="${p.accent}"/>`
  return `<path d="m148 66q-7-19 4-26-1 13 10 16 1-16 13-15-7 10-5 25" fill="${p.fill}"/>`
}
function face(id, state, p, blink) {
  const expression =
    state === 'rest' || blink
      ? closedEyes
      : state === 'celebrate'
        ? '<path d="M127 115q7-12 15 0m35 0q7-12 15 0" fill="none" stroke-width="2.8"/>'
        : `${openEyes(state === 'study')}<g class="pet-eyes-closed" opacity="0">${closedEyes}</g>`
  const mouth =
    id === 'duck'
      ? `<path d="M145 127q15-8 30 0-2 11-15 11t-15-11Z" fill="#edb45e" stroke="#c79551" stroke-width="1.8"/><path d="M148 129q12 3 24 0" fill="none" stroke="#cb9753" stroke-width="1.4"/>`
      : id === 'dog' || id === 'bear'
        ? `<ellipse cx="160" cy="133" rx="20" ry="15" fill="${p.belly}" stroke="none"/><path d="M155 127q5-5 10 0l-5 5Z" fill="${eyes}" stroke="none"/><path d="M160 132v3m-7 0q7 ${state === 'celebrate' ? 10 : 6} 14 0" fill="none" stroke-width="1.9"/>`
        : `<path d="M156 127q4-4 8 0l-4 4Z" fill="#c7978e" stroke="none"/><path d="M160 131q-4 6-8 2m8-2q4 6 8 2" fill="none" stroke-width="1.9"/>`
  return `${expression}<ellipse cx="120" cy="130" rx="10" ry="5.5" fill="#efb5a2" opacity=".62" stroke="none"/><ellipse cx="200" cy="130" rx="10" ry="5.5" fill="#efb5a2" opacity=".62" stroke="none"/>${mouth}`
}
function head(id, state, p, blink) {
  return `<g class="pet-head"><g${state === 'rest' ? ' transform="translate(0 7) rotate(-7 160 120)"' : ''}>${ears(id, p)}<ellipse cx="160" cy="112" rx="61" ry="52" fill="${p.fill}"/>${id === 'cat' ? '<path d="m151 65 2 10m14-10-1 10" stroke="#d3a181" stroke-width="2"/>' : ''}${face(id, state, p, blink)}</g></g>`
}
function body(p) {
  return `<g class="pet-body"><ellipse cx="131" cy="221" rx="17" ry="8" fill="${p.fill}"/><ellipse cx="189" cy="221" rx="17" ry="8" fill="${p.fill}"/><path d="M124 149q-23 15-22 44 0 32 29 34h58q29-2 29-34 1-29-22-44Z" fill="${p.fill}"/><ellipse cx="160" cy="187" rx="34" ry="31" fill="${p.belly}" stroke="none"/></g>`
}
function book(p) {
  return `<g class="pet-reading-arms"><path d="M117 164q-22 6-12 34l21 1 8-21m69-14q22 6 12 34l-21 1-8-21" fill="${p.fill}"/></g><g class="pet-book"><path d="M100 179q31-9 60 5 29-14 60-5l-6 44q-30-5-54 5-24-10-54-5Z" fill="#99b39a" stroke="#79917c" stroke-width="2.3"/><path d="M105 174q31-5 55 10 24-15 55-10l-4 43q-27-3-51 7-24-10-51-7Z" fill="#fffdf1" stroke="#a5b69b" stroke-width="1.8"/><path d="M160 184v39" fill="none" stroke="#9cad92" stroke-width="1.6"/><path d="m117 187 29 6m-28 4 27 6m30-10 29-6m-28 16 27-6" stroke="#c0c9ae" stroke-width="1.7"/><path class="pet-page" opacity="0" d="M162 184q24-14 52-10l-3 43q-27-3-49 7Z" fill="#fff9e4" stroke="#adbda0" stroke-width="1.5"/><path d="m190 179 7-2-1 15-4-2-4 4Z" fill="#d7b78b" stroke="none"/></g><g class="pet-book-hands"><ellipse cx="111" cy="191" rx="10" ry="13" fill="${p.fill}" transform="rotate(-19 111 191)"/><ellipse cx="209" cy="191" rx="10" ry="13" fill="${p.fill}" transform="rotate(19 209 191)"/></g>`
}
function clapping(p) {
  return `<g class="pet-hand-left"><path d="M119 174q-15 8-6 19 8 10 29-3l6-15-14-6" fill="${p.fill}"/><ellipse cx="147" cy="177" rx="11" ry="17" fill="${p.fill}" transform="rotate(-22 147 177)"/><path d="m143 174 2 5" fill="none" stroke="${p.accent}" stroke-width="1.6"/></g><g class="pet-hand-right"><path d="M201 174q15 8 6 19-8 10-29-3l-6-15 14-6" fill="${p.fill}"/><ellipse cx="173" cy="177" rx="11" ry="17" fill="${p.fill}" transform="rotate(22 173 177)"/><path d="m177 174-2 5" fill="none" stroke="${p.accent}" stroke-width="1.6"/></g><g class="pet-clap-lines" opacity="0" fill="none" stroke="#c8a365" stroke-width="2.5"><path d="M160 153v-7m-20 9-4-5m44 5 4-5"/></g><g class="pet-celebrate-stars" fill="#dcc689" stroke="none"><path d="m83 104 3-7 3 7 7 3-7 3-3 7-3-7-7-3Zm147-25 3-7 3 7 7 3-7 3-3 7-3-7-7-3Z"/><circle cx="236" cy="132" r="2.8"/><circle cx="85" cy="143" r="2.3"/></g>`
}
function sleeping() {
  return `<g class="pet-blanket"><path d="M104 186q55-15 112 0l9 29q-63 24-130 0Z" fill="#c7d8cd" stroke="#9cb5a5" stroke-width="2.1"/><path d="M104 190q55-12 112 0" fill="none" stroke="#eef3e9" stroke-width="3"/><path d="m182 201 3-5 3 5 6 1-4 4 1 6-6-3-5 3 1-6-4-4Z" fill="#eef0d9" stroke="none"/><path d="m116 206 6 4m18-10 6 4m56 9 5-3" fill="none" stroke="#afc6b8" stroke-width="1.7"/></g><g class="pet-sleep-z" fill="none" stroke="#9caf9f" stroke-width="2.1"><path class="pet-z-small" d="M233 104h7l-7 9h8"/><path class="pet-z-large" d="M248 78h10l-10 13h11"/></g>`
}
export function artwork(id, state, blink = false) {
  const p = animals[id]
  const pillow =
    state === 'rest'
      ? '<rect class="pet-pillow" x="108" y="158" width="104" height="33" rx="16" fill="#fff8e8" stroke="#d9cbb1" stroke-width="2"/>'
      : ''
  const hands =
    state === 'study'
      ? book(p)
      : state === 'celebrate'
        ? clapping(p)
        : state === 'rest'
          ? sleeping()
          : `<path d="M115 171q-10 13-2 25m92-25q10 13 2 25" fill="none"/><ellipse cx="114" cy="198" rx="12" ry="11" fill="${p.fill}"/><ellipse cx="206" cy="198" rx="12" ry="11" fill="${p.fill}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 250" aria-hidden="true"><ellipse cx="160" cy="229" rx="88" ry="9" fill="#a9bfa9" opacity=".18"/><g fill="none" stroke="${outline}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body(p)}${pillow}${head(id, state, p, blink)}${hands}</g></svg>`
}
export function generateCompanions() {
  const assets = {}
  for (const id of Object.keys(animals)) {
    const dir = resolve('public/companions', id)
    mkdirSync(dir, { recursive: true })
    for (const state of ['idle', 'study', 'rest', 'celebrate', 'blink', 'idle-blink']) {
      const svg = artwork(
        id,
        state === 'blink' ? 'study' : state === 'idle-blink' ? 'idle' : state,
        state === 'blink' || state === 'idle-blink',
      )
      writeFileSync(resolve(dir, `${state}.svg`), svg)
      assets[`companions/${id}/${state}.svg`] = svg
    }
  }
  writeFileSync(
    resolve('src/companions/artwork.generated.json'),
    JSON.stringify(assets, null, 2) + '\n',
  )
}
