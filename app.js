'use strict';
const $ = (id) => document.getElementById(id);
const WIDTH = 515.88, HEIGHT = 728.52;
const loaded = new Map(), shown = new Set();
let lesson;

function setSheet(button, open) {
  button.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', `問題${button.dataset.question}の解答を${open ? '隠す' : '表示'}`);
  button.querySelector('.sheet-label').textContent = open ? 'もう一度隠す' : 'タップで解答';
}
function toggleQuestion(number) {
  const open = !shown.has(number);
  open ? shown.add(number) : shown.delete(number);
  document.querySelectorAll(`.sheet[data-question="${number}"]`).forEach(button => setSheet(button, open));
}
async function loadPage(page) {
  if (loaded.has(page)) return loaded.get(page);
  const frame = $(`page-${page}`), paper = frame.querySelector('.paper');
  const job = (async () => {
    try {
      const response = await fetch(`pages/${String(page).padStart(2, '0')}.html`);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const markup = await response.text();
      await document.fonts.ready;
      paper.innerHTML = markup;
      paper.querySelectorAll('.sheet[data-question]').forEach(button => setSheet(button, shown.has(Number(button.dataset.question))));
      frame.querySelector('.page-loading')?.remove();
      frame.removeAttribute('aria-busy');
    } catch (error) {
      loaded.delete(page);
      const loading = frame.querySelector('.page-loading');
      if (loading) {
        loading.innerHTML = '<button type="button">読み込み直す</button>';
        loading.querySelector('button').onclick = () => {
          loading.textContent = 'ページを読み込んでいます…';
          loadPage(page);
        };
      }
      console.error(`Page ${page}:`, error);
    }
  })();
  loaded.set(page, job);
  return job;
}
function resizeReader() {
  const width = Math.round(Math.min(780, $('reader-viewport').clientWidth - (innerWidth <= 600 ? 20 : 40)));
  $('reader').style.setProperty('--reader-width', `${width}px`);
  $('reader').style.setProperty('--page-scale', width / WIDTH);
  $('reader').style.setProperty('--page-height', `${width / WIDTH * HEIGHT}px`);
}
function scrollToPage(page, y = 0) {
  const frame = $(`page-${page}`);
  if (!frame) return;
  const top = frame.getBoundingClientRect().top + scrollY + y * frame.clientWidth / WIDTH - 22;
  window.scrollTo({top: Math.max(0, top), behavior: 'instant'});
  $('reader-viewport').scrollLeft = 0;
  loadPage(page);
}
function goQuestion(number) {
  const question = lesson.problems.find(item => item.number === number);
  if (!question) return;
  scrollToPage(question.page, question.y - 12);
  history.replaceState(null, '', `#q${number}`);
  $('question-select').value = number;
}
function syncQuestion() {
  const target = 44;
  const scale = $('reader').clientWidth / WIDTH;
  const tops = new Map();
  let number = lesson.problems[0].number;
  for (const question of lesson.problems) {
    if (!tops.has(question.page)) tops.set(question.page, $(`page-${question.page}`).getBoundingClientRect().top);
    if (tops.get(question.page) + question.y * scale > target) break;
    number = question.number;
  }
  $('question-select').value = number;
}
async function init() {
  try {
    const response = await fetch('lesson.json');
    if (!response.ok) throw new Error('lesson.json');
    lesson = await response.json();
    const fragment = document.createDocumentFragment();
    lesson.pages.forEach(({page, questions}) => {
      const section = document.createElement('section');
      section.className = 'page-frame';
      section.id = `page-${page}`;
      section.setAttribute('aria-label', `${page}ページ${questions.length ? `、問題${questions[0]}〜${questions.at(-1)}` : '、前問の別解'}`);
      section.setAttribute('aria-busy', 'true');
      section.innerHTML = '<div class="paper"></div><div class="page-loading">ページを読み込んでいます…</div>';
      fragment.append(section);
    });
    $('reader').append(fragment);
    $('question-select').replaceChildren(...lesson.problems.map(({number}) => {
      const option = document.createElement('option');
      option.value = number;
      option.textContent = String(number);
      return option;
    }));
    $('question-select').disabled = false;
    resizeReader();
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) loadPage(Number(entry.target.id.slice(5)));
    }), {rootMargin: '1000px 0px'});
    document.querySelectorAll('.page-frame').forEach(frame => observer.observe(frame));
    $('reader').addEventListener('click', event => {
      const sheet = event.target.closest('.sheet[data-question]');
      if (sheet) toggleQuestion(Number(sheet.dataset.question));
    });
    $('question-select').addEventListener('change', () => goQuestion(Number($('question-select').value)));
    let scrollPending = false;
    addEventListener('scroll', () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(() => { scrollPending = false; syncQuestion(); });
    }, {passive: true});
    addEventListener('resize', () => { resizeReader(); syncQuestion(); });
    await loadPage(1);
    const question = location.hash.match(/^#q(\d+)$/), page = location.hash.match(/^#page-(\d+)$/);
    if (question) goQuestion(Number(question[1]));
    else if (page) scrollToPage(Number(page[1]));
    syncQuestion();
  } catch (error) {
    $('reader').textContent = '読み込みに失敗しました。ページを再読み込みしてください。';
    console.error(error);
  }
}
init();
