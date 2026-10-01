'use strict';
const $ = (id) => document.getElementById(id);
const WIDTH = 515.88, HEIGHT = 728.52;
const loaded = new Map(), shown = new Set();
let lesson, zoom = 1, observer, currentPage = 1, timer;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fontSheets = {1:[22,65,493,304],2:[22,186,493,319],3:[22,48,493,164],6:[22,64,493,150],8:[22,61,493,147],9:[22,67,493,187],11:[22,63,493,150],15:[43,354,245,407],16:[293,370,494,670],20:[82,61,343,111],24:[22,56,493,314],25:[65,45,490,118]};
function toast(message) { $('toast').textContent=message; $('toast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>{$('toast').hidden=true;},2200); }
function updateCount() { $('reveal-count').textContent=`解答表示 ${shown.size} / 71`; }
function setSheet(button, open) {
  button.classList.toggle('open',open);button.setAttribute('aria-expanded',String(open));
  const q=button.dataset.question;
  button.setAttribute('aria-label',q?`問題${q}の解答を${open?'隠す':'表示'}`:`公式・説明を${open?'隠す':'表示'}`);
  button.querySelector('.sheet-label').textContent=open?'もう一度隠す':'タップで解答';
  if(button.dataset.formula&&!open) button.querySelector('.sheet-label').textContent='タップで公式・説明';
}
function toggleQuestion(number) {
  const open=!shown.has(number);open?shown.add(number):shown.delete(number);
  document.querySelectorAll(`.sheet[data-question="${number}"]`).forEach(b=>setSheet(b,open));updateCount();
}
function addFormulaSheet(paper,page) {
  if(!fontSheets[page]||paper.querySelector('[data-formula]'))return;
  const [x,y,r,b]=fontSheets[page];const button=document.createElement('button');button.type='button';button.className='sheet';button.dataset.formula='true';
  button.style.cssText=`--x:${x}px;--y:${y}px;--w:${r-x}px;--h:${b-y}px`;
  button.innerHTML='<span class="sheet-label">タップで公式・説明</span>';setSheet(button,false);paper.append(button);
}
async function loadPage(page) {
  if(loaded.has(page))return loaded.get(page);
  const frame=$(`page-${page}`),paper=frame.querySelector('.paper');
  const job=(async()=>{
    try{
      const response=await fetch(`pages/${String(page).padStart(2,'0')}.html`);
      if(!response.ok)throw new Error('HTTP '+response.status);
      const markup=await response.text();
      await document.fonts.ready;
      paper.innerHTML=markup;
      if($('formula-hide').checked)addFormulaSheet(paper,page);
      paper.querySelectorAll('.sheet[data-question]').forEach(b=>setSheet(b,shown.has(Number(b.dataset.question))));
      frame.querySelector('.page-loading')?.remove();frame.removeAttribute('aria-busy');
    }catch(error){
      loaded.delete(page);const loading=frame.querySelector('.page-loading');
      if(loading){loading.innerHTML='<button type="button">読み込み直す</button>';loading.querySelector('button').onclick=()=>{loading.textContent='ページを読み込んでいます…';loadPage(page);};}
      console.error(`Page ${page}:`,error);
    }
  })();loaded.set(page,job);return job;
}
function resizeReader() {
  const viewport=$('reader-viewport');const fit=Math.min(780,viewport.clientWidth-(innerWidth<=600?20:40));const width=Math.round(fit*zoom);
  $('reader').style.setProperty('--reader-width',`${width}px`);
  $('reader').style.setProperty('--page-scale',width/WIDTH);
  $('reader').style.setProperty('--page-height',`${width/WIDTH*HEIGHT}px`);
  $('zoom-fit').textContent=Math.round(zoom*100)+'%';$('zoom-out').disabled=zoom<=1;$('zoom-in').disabled=zoom>=3;
  document.documentElement.style.setProperty('--header-h',`${document.querySelector('.header').offsetHeight}px`);
}
function scrollToPage(page, y=0) {
  const frame=$(`page-${page}`);if(!frame)return;
  const scale=frame.clientWidth/WIDTH;
  const top=frame.getBoundingClientRect().top+scrollY+y*scale-document.querySelector('.header').offsetHeight-22;
  window.scrollTo({top:Math.max(0,top),behavior:reducedMotion?'instant':'smooth'});
  $('reader-viewport').scrollLeft=0;loadPage(page);
  currentPage=page;$('page-select').value=page;
}
function goQuestion(number) {
  const q=lesson.problems.find(q=>q.number===number);if(!q){toast('問題番号は1〜71です');return;}
  scrollToPage(q.page,q.y-25);history.replaceState(null,'',`#q${number}`);$('question-input').value=number;
}
function closeContents() {$('contents').hidden=true;$('contents-button').setAttribute('aria-expanded','false');}
async function init() {
  try{
    const response=await fetch('lesson.json');if(!response.ok)throw new Error('lesson.json');lesson=await response.json();
    const fragment=document.createDocumentFragment();
    lesson.pages.forEach(({page,questions})=>{
      const opt=document.createElement('option');opt.value=page;opt.textContent=page;$('page-select').append(opt);
      const section=document.createElement('section');section.className='page-frame';section.id=`page-${page}`;section.setAttribute('aria-label',`${page}ページ${questions.length?`、問題${questions[0]}〜${questions.at(-1)}`:'、前問の別解'}`);section.setAttribute('aria-busy','true');
      section.innerHTML='<div class="paper"></div><div class="page-loading">ページを読み込んでいます…</div>';fragment.append(section);
    });$('reader').append(fragment);resizeReader();
    lesson.sections.forEach(({page,title},i)=>{const b=document.createElement('button');b.type='button';b.innerHTML=`<small>${String(i+1).padStart(2,'0')}</small><span>${title}</span>`;b.onclick=()=>{scrollToPage(page);closeContents();};$('section-list').append(b);});
    observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){loadPage(Number(e.target.id.slice(5)));}}),{rootMargin:'1000px 0px'});
    document.querySelectorAll('.page-frame').forEach(frame=>observer.observe(frame));
    $('reader').addEventListener('click',e=>{const sheet=e.target.closest('.sheet');if(!sheet)return;if(sheet.dataset.question)toggleQuestion(Number(sheet.dataset.question));else setSheet(sheet,!sheet.classList.contains('open'));});
    $('page-select').onchange=()=>{scrollToPage(Number($('page-select').value));history.replaceState(null,'',`#page-${$('page-select').value}`);};
    $('question-form').onsubmit=e=>{e.preventDefault();goQuestion(Number($('question-input').value));};
    $('home').onclick=e=>{e.preventDefault();scrollToPage(1);history.replaceState(null,'',location.pathname);};
    $('hide-all').onclick=()=>{shown.clear();document.querySelectorAll('.sheet').forEach(b=>setSheet(b,false));updateCount();toast('解答をすべて隠しました');};
    $('formula-hide').onchange=()=>{document.querySelectorAll('.paper').forEach((p,i)=>{$('formula-hide').checked?addFormulaSheet(p,i+1):p.querySelector('[data-formula]')?.remove();});};
    $('zoom-in').onclick=()=>{zoom=Math.min(3,zoom+.25);resizeReader();};$('zoom-out').onclick=()=>{zoom=Math.max(1,zoom-.25);resizeReader();};$('zoom-fit').onclick=()=>{zoom=1;resizeReader();$('reader-viewport').scrollLeft=0;};
    $('contents-button').onclick=()=>{const open=$('contents').hidden;$('contents').hidden=!open;$('contents-button').setAttribute('aria-expanded',String(open));};$('contents-close').onclick=closeContents;
    document.addEventListener('click',e=>{if(!e.target.closest('#contents, #contents-button'))closeContents();});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeContents();});
    let scrollPending=false;addEventListener('scroll',()=>{if(scrollPending)return;scrollPending=true;requestAnimationFrame(()=>{scrollPending=false;const target=document.querySelector('.header').offsetHeight+80;let nearest=1;for(const f of document.querySelectorAll('.page-frame')){if(f.getBoundingClientRect().top<=target)nearest=Number(f.id.slice(5));else break;}if(currentPage!==nearest){currentPage=nearest;$('page-select').value=nearest;}});},{passive:true});
    addEventListener('resize',resizeReader);new ResizeObserver(()=>document.documentElement.style.setProperty('--header-h',`${document.querySelector('.header').offsetHeight}px`)).observe(document.querySelector('.header'));
    await loadPage(1);const q=location.hash.match(/^#q(\d+)$/),p=location.hash.match(/^#page-(\d+)$/);if(q)goQuestion(Number(q[1]));else if(p)scrollToPage(Number(p[1]));
  }catch(error){$('reader').textContent='読み込みに失敗しました。ページを再読み込みしてください。';console.error(error);}
}
init();
