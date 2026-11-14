export type AssignmentStatus = 'Due soon' | 'In progress' | 'Saved locally';

export type Assignment = {
  id: string;
  title: string;
  subject: string;
  teacher: string;
  due: string;
  progress: number;
  status: AssignmentStatus;
  tone: 'math' | 'history' | 'science';
};

export const assignments: Assignment[] = [
  { id: 'algebra-1', title: 'Quadratic equations practice', subject: 'Mathematics', teacher: 'Ms. Rivera', due: 'Due tomorrow, 11:59 PM', progress: 72, status: 'Due soon', tone: 'math' },
  { id: 'history-1', title: 'Industrial Revolution essay', subject: 'World History', teacher: 'Mr. Adams', due: 'Due Nov 17, 2026', progress: 38, status: 'In progress', tone: 'history' },
  { id: 'biology-1', title: 'Cell observation lab report', subject: 'Biology', teacher: 'Dr. Chen', due: 'Due Nov 20, 2026', progress: 16, status: 'Saved locally', tone: 'science' },
];

export const classes = [
  ['Algebra II', 'Ms. Rivera · Room 204', '89%', 'purple'],
  ['World History', 'Mr. Adams · Room 116', '94%', 'blue'],
  ['Biology', 'Dr. Chen · Lab 2', '93%', 'green'],
  ['English Literature', 'Ms. Patel · Room 301', '96%', 'orange'],
] as const;
