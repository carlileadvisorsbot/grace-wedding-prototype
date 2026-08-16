const tabs = [...document.querySelectorAll('[role="tab"]')];
const panels = [...document.querySelectorAll('[role="tabpanel"]')];
const tabTargets = [...document.querySelectorAll('[data-tab-target]')];
const validPanels = new Set(panels.map(panel => panel.id));

function activatePanel(id, { updateHistory = false, focusPanel = false } = {}) {
  const panelId = validPanels.has(id) ? id : 'home';

  tabs.forEach(tab => {
    const active = tab.getAttribute('aria-controls') === panelId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  panels.forEach(panel => panel.classList.toggle('is-active', panel.id === panelId));

  if (updateHistory && window.location.hash !== `#${panelId}`) {
    window.history.pushState({ panel: panelId }, '', `#${panelId}`);
  }

  document.querySelector(`[aria-controls="${panelId}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (focusPanel) document.getElementById(panelId)?.focus({ preventScroll: true });
}

function panelFromLocation() {
  return window.location.hash.slice(1) || 'home';
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', event => {
    event.preventDefault();
    activatePanel(tab.getAttribute('aria-controls'), { updateHistory: true });
  });

  tab.addEventListener('keydown', event => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    tabs[nextIndex].focus();
    activatePanel(tabs[nextIndex].getAttribute('aria-controls'), { updateHistory: true });
  });
});

tabTargets.forEach(link => link.addEventListener('click', event => {
  const id = link.dataset.tabTarget;
  if (!validPanels.has(id)) return;
  event.preventDefault();
  activatePanel(id, { updateHistory: true, focusPanel: link.classList.contains('soft-button') });
}));

window.addEventListener('popstate', () => activatePanel(panelFromLocation()));
activatePanel(panelFromLocation());
window.addEventListener('load', () => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }));
}, { once: true });

const lightbox = document.querySelector('#lightbox');
const galleryItems = [...document.querySelectorAll('[data-full]')];
let activePhoto = 0;

function showPhoto(index) {
  activePhoto = (index + galleryItems.length) % galleryItems.length;
  const item = galleryItems[activePhoto];
  const image = lightbox.querySelector('img');
  image.src = item.dataset.full;
  image.alt = item.querySelector('img')?.alt || '';
  lightbox.querySelector('figcaption').textContent = `${item.dataset.caption || ''} · ${activePhoto + 1} of ${galleryItems.length}`;
}

galleryItems.forEach((item, index) => item.addEventListener('click', () => {
  showPhoto(index);
  lightbox.showModal();
}));

lightbox?.querySelector('.lightbox-close').addEventListener('click', () => lightbox.close());
lightbox?.querySelector('.previous').addEventListener('click', () => showPhoto(activePhoto - 1));
lightbox?.querySelector('.next').addEventListener('click', () => showPhoto(activePhoto + 1));
lightbox?.addEventListener('click', event => {
  if (event.target === lightbox) lightbox.close();
});
lightbox?.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') showPhoto(activePhoto - 1);
  if (event.key === 'ArrowRight') showPhoto(activePhoto + 1);
});

document.querySelectorAll('details').forEach(detail => {
  detail.addEventListener('toggle', () => {
    if (!detail.open) return;
    document.querySelectorAll('details[open]').forEach(other => {
      if (other !== detail) other.removeAttribute('open');
    });
  });
});
