const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('.mobile-nav');
const lightbox = document.querySelector('#lightbox');
const galleryItems = [...document.querySelectorAll('[data-full]')];
let activePhoto = 0;

const syncHeader = () => header?.classList.toggle('scrolled', window.scrollY > 54);
syncHeader();
window.addEventListener('scroll', syncHeader, { passive: true });

function closeMenu() {
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Open menu');
  mobileNav?.classList.remove('open');
}

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
  mobileNav?.classList.toggle('open', !isOpen);
});

mobileNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));

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

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveals = document.querySelectorAll('.reveal');
if (prefersReducedMotion || !('IntersectionObserver' in window)) {
  reveals.forEach(item => item.classList.add('in-view'));
} else {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in-view');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -35px' });
  reveals.forEach(item => observer.observe(item));
}
