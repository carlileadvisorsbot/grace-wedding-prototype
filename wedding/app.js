const modal = document.querySelector('#rsvp-modal');
const openers = document.querySelectorAll('[data-open-rsvp]');
const closeButton = document.querySelector('.modal-close');
const form = document.querySelector('#rsvp-demo');
const result = document.querySelector('.demo-result');

openers.forEach((button) => button.addEventListener('click', () => {
  result.textContent = '';
  form.reset();
  modal.showModal();
  setTimeout(() => document.querySelector('#guest-name').focus(), 0);
}));

closeButton.addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => {
  const box = modal.getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (outside) modal.close();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = new FormData(form).get('guest-name').trim();
  result.textContent = name
    ? `Demo only — no lookup was performed for “${name}” and nothing was saved.`
    : 'Enter a sample name to preview the guest-safe response.';
});
