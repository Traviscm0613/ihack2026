export function assignmentDueDate(date: string, time: string) {
  const clock = time.trim() || '23:59';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
    throw Error('Enter a due date (YYYY-MM-DD) and time (HH:MM).');
  }
  const due = new Date(`${date}T${clock}:00`);
  const [year, month, day] = date.split('-').map(Number);
  if (Number.isNaN(due.getTime()) || due.getFullYear() !== year || due.getMonth() + 1 !== month || due.getDate() !== day || due.getHours() !== Number(clock.slice(0, 2)) || due.getMinutes() !== Number(clock.slice(3))) {
    throw Error('Enter a valid local due date and time.');
  }
  return due.toISOString();
}
