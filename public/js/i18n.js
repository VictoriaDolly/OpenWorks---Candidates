import { storage } from './shared.js';

// UI strings only. Stage names and candidate content are data and are never translated.
const STRINGS = {
  en: {
    board: 'Board', list: 'List',
    noRefTitle: 'This link has no pipeline reference',
    noRefBody: 'Please use the full link shared with you by OpenWorks.',
    notFoundTitle: 'Pipeline not available',
    notFoundBody: "This link is invalid or hasn't been published yet.",
    loadError: "We couldn't load this pipeline. Please refresh and try again.",
    gateTitle: 'Protected pipeline',
    gateBody: 'Enter the password OpenWorks shared with you.',
    password: 'Password', unlock: 'View candidates', checking: 'Checking…',
    wrongPassword: 'Incorrect password. Please try again.',
    candidatesOne: '1 candidate', candidatesMany: '{n} candidates',
    emptyColumn: 'No candidates', emptyPipeline: 'No candidates have been shared yet.',
    colCandidate: 'Candidate', colLocation: 'Location', colStatus: 'Status', colAvg: 'Avg Score',
    secContact: 'Contact', secResume: 'Resume', secRecommendation: 'Overall Recommendation',
    secNotes: 'Screening Interview Notes', toConsider: 'To consider:',
    secAvailability: 'Availability & Expectations', secFeedback: 'Interview Feedback',
    av_motivation: 'Motivation to change', av_noticePeriod: 'Notice period',
    av_otherProcesses: 'Other hiring processes', av_vacationPlans: 'Vacation / migration plans',
    av_visaStatus: 'Visa status', av_salaryExpectations: 'Salary expectations',
    open: 'Open ↗', close: 'Close', resumeFile: 'Resume',
    score_1: 'Strong No', score_2: 'No', score_3: 'Yes', score_4: 'Strong Yes',
    avgScore: 'Average score',
    fbYourName: 'Your name', fbPlaceholder: 'Share your notes from this stage…',
    fbScore: 'Score', fbSave: 'Save note', fbSaving: 'Saving…',
    fbDelete: 'Delete note', fbConfirmDelete: 'Delete this note? This cannot be undone.',
    fbEmpty: 'No notes yet.', fbNeedBody: 'Write a note before saving.', fbNeedName: 'Please add your name.',
    fbSaved: 'Note saved', fbDeleted: 'Note deleted', fbError: 'Something went wrong. Please try again.',
    fbLoadError: "Feedback couldn't be loaded right now.", fbAnonymous: 'Anonymous',
    fbNotesOne: '1 note', fbNotesMany: '{n} notes',
  },
  es: {
    board: 'Tablero', list: 'Lista',
    noRefTitle: 'Este enlace no tiene referencia a un pipeline',
    noRefBody: 'Usa el enlace completo que te compartió OpenWorks.',
    notFoundTitle: 'Pipeline no disponible',
    notFoundBody: 'El enlace no es válido o todavía no se ha publicado.',
    loadError: 'No pudimos cargar este pipeline. Actualiza la página e inténtalo de nuevo.',
    gateTitle: 'Pipeline protegido',
    gateBody: 'Ingresa la contraseña que te compartió OpenWorks.',
    password: 'Contraseña', unlock: 'Ver candidatos', checking: 'Verificando…',
    wrongPassword: 'Contraseña incorrecta. Inténtalo de nuevo.',
    candidatesOne: '1 candidato', candidatesMany: '{n} candidatos',
    emptyColumn: 'Sin candidatos', emptyPipeline: 'Todavía no se han compartido candidatos.',
    colCandidate: 'Candidato', colLocation: 'Ubicación', colStatus: 'Etapa', colAvg: 'Puntaje prom.',
    secContact: 'Contacto', secResume: 'CV', secRecommendation: 'Recomendación general',
    secNotes: 'Notas de la entrevista de screening', toConsider: 'A tener en cuenta:',
    secAvailability: 'Disponibilidad y expectativas', secFeedback: 'Feedback de entrevistas',
    av_motivation: 'Motivación para el cambio', av_noticePeriod: 'Período de preaviso',
    av_otherProcesses: 'Otros procesos de selección', av_vacationPlans: 'Planes de vacaciones / migración',
    av_visaStatus: 'Situación de visa', av_salaryExpectations: 'Expectativa salarial',
    open: 'Abrir ↗', close: 'Cerrar', resumeFile: 'CV',
    score_1: 'Definitivamente no', score_2: 'No', score_3: 'Sí', score_4: 'Definitivamente sí',
    avgScore: 'Puntaje promedio',
    fbYourName: 'Tu nombre', fbPlaceholder: 'Comparte tus notas de esta etapa…',
    fbScore: 'Puntaje', fbSave: 'Guardar nota', fbSaving: 'Guardando…',
    fbDelete: 'Eliminar nota', fbConfirmDelete: '¿Eliminar esta nota? No se puede deshacer.',
    fbEmpty: 'Todavía no hay notas.', fbNeedBody: 'Escribe una nota antes de guardar.', fbNeedName: 'Agrega tu nombre.',
    fbSaved: 'Nota guardada', fbDeleted: 'Nota eliminada', fbError: 'Algo salió mal. Inténtalo de nuevo.',
    fbLoadError: 'No se pudo cargar el feedback en este momento.', fbAnonymous: 'Anónimo',
    fbNotesOne: '1 nota', fbNotesMany: '{n} notas',
  },
};

function detect() {
  const saved = storage.get('ow_lang');
  if (saved === 'en' || saved === 'es') return saved;
  return String(navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en';
}

let lang = detect();
document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(next) {
  lang = next === 'es' ? 'es' : 'en';
  storage.set('ow_lang', lang);
  document.documentElement.lang = lang;
}

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Fixed-English translator for the admin (internal tool).
export function tEn(key, vars = {}) {
  return (STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
