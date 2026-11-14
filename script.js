const sidebar = document.querySelector('#sidebar');
const toast = document.querySelector('#toast');

document.querySelector('#mobileMenu').addEventListener('click', () => sidebar.classList.toggle('open'));

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
    link.classList.add('active');
    sidebar.classList.remove('open');
  });
});

document.querySelector('#search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.assignment').forEach((assignment) => {
    assignment.hidden = query.length > 0 && !assignment.dataset.search.includes(query);
  });
});

document.querySelectorAll('.assignment, .calendar-event').forEach((item) => {
  item.addEventListener('click', () => showToast('Opening local assignment details…'));
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}
