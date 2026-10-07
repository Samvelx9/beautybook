// Starter price lists a new master can pick at sign-up (or later from the
// Treatments screen), so they begin from a sensible shape instead of an empty
// page. Each template is one or more treatments with their usual zones and
// typical durations.
//
// Prices are deliberately not part of a template — they are the master's to
// set — so every zone is created at price 0 and *hidden*: it shows up in the
// admin panel ready to price, and only appears on the booking page once the
// master turns it on.

const z = (slug, minutes, en, ru, hy) => ({ slug, minutes, en, ru, hy });

const BODY_ZONES = [
  z('upper-lip', 10, 'Upper lip', 'Верхняя губа', 'Վերին շրթունք'),
  z('chin', 10, 'Chin', 'Подбородок', 'Կզակ'),
  z('face', 20, 'Full face', 'Всё лицо', 'Ամբողջ դեմքը'),
  z('underarms', 15, 'Underarms', 'Подмышки', 'Թևատակեր'),
  z('arms-to-elbow', 20, 'Arms to the elbow', 'Руки до локтя', 'Ձեռքեր՝ մինչև արմունկ'),
  z('full-arms', 30, 'Full arms', 'Руки полностью', 'Ձեռքերն ամբողջությամբ'),
  z('legs-to-knee', 30, 'Legs to the knee', 'Ноги до колена', 'Ոտքեր՝ մինչև ծունկ'),
  z('full-legs', 45, 'Full legs', 'Ноги полностью', 'Ոտքերն ամբողջությամբ'),
  z('stomach', 15, 'Stomach', 'Живот', 'Որովայն'),
  z('full-back', 20, 'Full back', 'Спина полностью', 'Մեջքն ամբողջությամբ'),
  z('classic-bikini', 20, 'Classic bikini', 'Бикини классическое', 'Դասական բիկինի'),
  z('deep-bikini', 30, 'Deep bikini', 'Бикини глубокое', 'Խորը բիկինի'),
];

export const TEMPLATES = {
  depilation: {
    label: { en: 'Waxing & sugaring', ru: 'Депиляция (воск, шугаринг)', hy: 'Դեպիլյացիա (մոմ, շաքար)' },
    treatments: [
      {
        slug: 'waxing',
        en: 'Waxing', ru: 'Депиляция воском', hy: 'Մոմադեպիլյացիա',
        zones: BODY_ZONES,
      },
      {
        slug: 'sugaring',
        en: 'Sugaring', ru: 'Шугаринг', hy: 'Շաքարադեպիլյացիա',
        zones: BODY_ZONES,
      },
      {
        slug: 'electrolysis',
        en: 'Electrolysis', ru: 'Электроэпиляция', hy: 'Էլեկտրաէպիլյացիա',
        hourly: true,
        zones: [z('session', 60, 'Session', 'Сеанс', 'Սեանս')],
      },
    ],
  },
  nails: {
    label: { en: 'Nails', ru: 'Ногтевой сервис', hy: 'Եղունգներ' },
    treatments: [
      {
        slug: 'manicure',
        en: 'Manicure', ru: 'Маникюр', hy: 'Մատնահարդարում',
        zones: [
          z('classic', 60, 'Classic manicure', 'Классический маникюр', 'Դասական մատնահարդարում'),
          z('gel-polish', 90, 'Manicure with gel polish', 'Маникюр с покрытием гель-лак', 'Մատնահարդարում գել-լաքով'),
          z('extensions', 150, 'Nail extensions', 'Наращивание ногтей', 'Եղունգների երկարացում'),
          z('removal', 30, 'Gel removal', 'Снятие покрытия', 'Ծածկույթի հեռացում'),
        ],
      },
      {
        slug: 'pedicure',
        en: 'Pedicure', ru: 'Педикюр', hy: 'Ոտնահարդարում',
        zones: [
          z('classic', 75, 'Classic pedicure', 'Классический педикюр', 'Դասական ոտնահարդարում'),
          z('gel-polish', 90, 'Pedicure with gel polish', 'Педикюр с покрытием гель-лак', 'Ոտնահարդարում գել-լաքով'),
        ],
      },
    ],
  },
  browsLashes: {
    label: { en: 'Brows & lashes', ru: 'Брови и ресницы', hy: 'Հոնքեր և թարթիչներ' },
    treatments: [
      {
        slug: 'brows',
        en: 'Brows', ru: 'Брови', hy: 'Հոնքեր',
        zones: [
          z('shaping', 30, 'Brow shaping', 'Коррекция бровей', 'Հոնքերի ուղղում'),
          z('tint', 30, 'Brow tinting', 'Окрашивание бровей', 'Հոնքերի ներկում'),
          z('lamination', 60, 'Brow lamination', 'Ламинирование бровей', 'Հոնքերի լամինացիա'),
        ],
      },
      {
        slug: 'lashes',
        en: 'Lashes', ru: 'Ресницы', hy: 'Թարթիչներ',
        zones: [
          z('lift', 60, 'Lash lift', 'Ламинирование ресниц', 'Թարթիչների լամինացիա'),
          z('classic', 120, 'Classic extensions', 'Классическое наращивание', 'Դասական երկարացում'),
          z('volume', 150, 'Volume extensions', 'Объёмное наращивание', 'Ծավալային երկարացում'),
          z('refill', 90, 'Refill', 'Коррекция', 'Ուղղում'),
        ],
      },
    ],
  },
  hair: {
    label: { en: 'Hair', ru: 'Парикмахерские услуги', hy: 'Վարսահարդարում' },
    treatments: [
      {
        slug: 'hair',
        en: 'Hair', ru: 'Волосы', hy: 'Մազեր',
        zones: [
          z('womens-cut', 60, "Women's haircut", 'Женская стрижка', 'Կանացի սանրվածք'),
          z('mens-cut', 45, "Men's haircut", 'Мужская стрижка', 'Տղամարդու սանրվածք'),
          z('blow-dry', 45, 'Blow-dry & styling', 'Укладка', 'Հարդարում'),
          z('colour', 120, 'Colouring', 'Окрашивание', 'Ներկում'),
          z('highlights', 180, 'Highlights', 'Мелирование', 'Մելիրում'),
        ],
      },
    ],
  },
  massage: {
    label: { en: 'Massage', ru: 'Массаж', hy: 'Մերսում' },
    treatments: [
      {
        slug: 'massage',
        en: 'Massage', ru: 'Массаж', hy: 'Մերսում',
        zones: [
          z('classic', 60, 'Classic massage', 'Классический массаж', 'Դասական մերսում'),
          z('back', 30, 'Back massage', 'Массаж спины', 'Մեջքի մերսում'),
          z('lymphatic', 60, 'Lymphatic drainage', 'Лимфодренажный массаж', 'Լիմֆոդրենաժային մերսում'),
          z('anti-cellulite', 60, 'Anti-cellulite massage', 'Антицеллюлитный массаж', 'Հակացելյուլիտային մերսում'),
        ],
      },
    ],
  },
  facial: {
    label: { en: 'Facial care', ru: 'Уход за лицом', hy: 'Դեմքի խնամք' },
    treatments: [
      {
        slug: 'facial',
        en: 'Facial care', ru: 'Уход за лицом', hy: 'Դեմքի խնամք',
        zones: [
          z('cleansing', 90, 'Deep cleansing', 'Чистка лица', 'Դեմքի մաքրում'),
          z('peel', 60, 'Peel', 'Пилинг', 'Պիլինգ'),
          z('face-massage', 45, 'Face massage', 'Массаж лица', 'Դեմքի մերսում'),
        ],
      },
    ],
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

// Adds a template's treatments and zones to a master's price list. Names are
// filled only in the languages the master offers. A treatment whose slug the
// master already has is skipped rather than duplicated, so applying the same
// template twice is harmless.
export async function applyTemplate(client, master, key) {
  const template = TEMPLATES[key];
  if (!template) return 0;
  const langs = master.languages;
  const names = (item) => ['en', 'ru', 'hy'].map((l) => (langs.includes(l) ? item[l] : ''));

  const { rows: sortRows } = await client.query(
    'SELECT COALESCE(MAX(sort_order), 0) AS max FROM service_categories WHERE master_id = $1',
    [master.id]
  );
  let sortOrder = Number(sortRows[0].max);
  let added = 0;

  for (const treatment of template.treatments) {
    sortOrder += 1;
    const { rows } = await client.query(
      `INSERT INTO service_categories (master_id, slug, name_en, name_ru, name_hy, sort_order, is_hourly)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (master_id, slug) DO NOTHING
       RETURNING id`,
      [master.id, treatment.slug, ...names(treatment), sortOrder, Boolean(treatment.hourly)]
    );
    if (!rows[0]) continue;
    added += 1;

    for (const [index, zone] of treatment.zones.entries()) {
      await client.query(
        `INSERT INTO services (master_id, category_id, slug, name_en, name_ru, name_hy,
                               duration_minutes, price, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, false)
         ON CONFLICT (master_id, slug) DO NOTHING`,
        [master.id, rows[0].id, `${treatment.slug}-${zone.slug}`, ...names(zone), zone.minutes, index + 1]
      );
    }
  }
  return added;
}

// The list the sign-up form and the Treatments screen offer.
export function templateList() {
  return TEMPLATE_KEYS.map((key) => ({ key, label: TEMPLATES[key].label }));
}
