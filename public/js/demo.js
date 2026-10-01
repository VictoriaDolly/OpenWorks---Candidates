// Local demo pipeline, used ONLY while Supabase isn't configured (config.js empty).
// Open /?p=demo — password: demo. All people here are fictional.
import { hashPassword } from './shared.js';

export const DEMO_SLUG = 'demo';
const DEMO_SALT = 'demo-salt';
const DEMO_PASSWORD = 'demo';

const DEMO_PIPELINE = {
  slug: DEMO_SLUG,
  clientName: 'Acme Logistics',
  roleTitle: 'Senior Account Executive',
  candidates: [
    {
      id: '6f1c2b1e-0d1a-4b5e-9a10-2f3b4c5d6e7f',
      name: 'Valentina (Vale) Rojas',
      location: 'Medellín, Colombia',
      email: 'vale.rojas@example.com',
      linkedin: 'https://www.linkedin.com/in/example-valentina-rojas',
      status: 'Client Interviews',
      resume: { url: '/assets/demo-resume.pdf', label: 'Valentina_Rojas_Resume.pdf' },
      overallRecommendation: 'Recommended to Advance',
      screeningNotes: [
        '8 years in B2B SaaS sales; last 4 as Account Executive selling to US mid-market accounts.',
        'Closed $1.4M ARR in 2025 (128% of quota); average deal size $45K.',
        'Industries: logistics tech, supply chain, fintech.',
        'B.A. in International Business, Universidad EAFIT.',
        'English: C1, fluent in client-facing calls. Spanish native; basic Portuguese.',
        'Has worked with US teams for 5+ years (EST hours).',
        'Prefers fully remote; comfortable with occasional travel.',
        'Background in companies of 50–300 employees.',
      ],
      toConsider: 'Has not managed a team yet; most of her pipeline came from inbound leads.',
      availability: {
        motivation: 'Looking for a larger deal size and a company with a stronger US presence.',
        noticePeriod: '30 days',
        otherProcesses: 'One process at final stage with a US fintech.',
        vacationPlans: 'None planned.',
        visaStatus: 'B1/B2 visa valid until 2029.',
        salaryExpectations: 'USD 5,500 – 6,000 / month',
      },
    },
    {
      id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      name: 'Martín Gutiérrez',
      location: 'Buenos Aires, Argentina',
      email: 'martin.gutierrez@example.com',
      linkedin: 'linkedin.com/in/example-martin-gutierrez',
      status: 'Submitted',
      resume: { url: '/assets/demo-resume.pdf', label: 'Martin_Gutierrez_CV.pdf' },
      overallRecommendation: 'Advance with Reservations',
      screeningNotes: [
        '6 years in sales, 3 as Account Executive in logistics.',
        'Consistently above 100% of quota over the last 6 quarters.',
        'English: B2+, comfortable in calls; written English could improve.',
        'Experience selling to Latin American and Spanish customers.',
      ],
      toConsider: 'Limited direct experience with US buyers; expects a higher salary than the range shared.',
      availability: {
        motivation: 'Wants to work for a North American company and grow into enterprise deals.',
        noticePeriod: '2 weeks',
        salaryExpectations: 'USD 6,500 / month',
      },
    },
    {
      id: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b',
      name: 'Camila Duarte',
      location: 'Santiago, Chile',
      status: 'Rejected',
      overallRecommendation: 'Advance with Reservations',
      screeningNotes: ['4 years in inside sales for a regional software company.'],
    },
  ],
};

export const demoApi = {
  async salt(slug) { return slug === DEMO_SLUG ? DEMO_SALT : null; },
  async pipeline(slug, hash) {
    if (slug !== DEMO_SLUG) return null;
    return hash === await hashPassword(DEMO_SALT, DEMO_PASSWORD) ? structuredClone(DEMO_PIPELINE) : null;
  },
};
