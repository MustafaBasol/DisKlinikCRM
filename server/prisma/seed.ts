import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const colors = {
  blue: '#2563EB',
  teal: '#0D9488',
  green: '#16A34A',
  amber: '#D97706',
  red: '#DC2626',
  violet: '#7C3AED',
  pink: '#DB2777',
  cyan: '#0891B2',
  slate: '#475569',
  orange: '#EA580C',
};

async function main() {
  console.log('Starting Aile Dis single-branch demo seed...');

  await prisma.activityLog.deleteMany({});
  await prisma.sentMessage.deleteMany({});
  await prisma.messageTemplate.deleteMany({});
  await prisma.insuranceProvision.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.treatmentCase.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.appointmentType.deleteMany({});
  await prisma.doctorAvailability.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.clinic.deleteMany({});

  const passwordHash = await bcrypt.hash('password123', 10);

  const clinic = await prisma.clinic.create({
    data: {
      name: 'Aile Dis',
      legalName: 'Ozel Aile Dis Agiz ve Dis Sagligi Poliklinigi',
      address: 'Osmangazi, Ahmet Yesevi Cd 8/C, 34887 Sancaktepe/Istanbul',
      phone: '+90 (216) 311 0 888',
      email: 'info@ailedis.com',
      website: 'https://ailedis.com',
      timezone: 'Europe/Istanbul',
      currency: 'TRY',
      defaultLanguage: 'tr',
    },
  });

  const admin = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      firstName: 'Klinik',
      lastName: 'Yoneticisi',
      email: 'admin@ailedis.com',
      phone: '+90 216 311 08 88',
      role: 'admin',
      passwordHash,
    },
  });

  const receptionist = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      firstName: 'Resepsiyon',
      lastName: 'Ekibi',
      email: 'resepsiyon@ailedis.com',
      phone: '+90 543 311 38 88',
      role: 'receptionist',
      passwordHash,
    },
  });

  const billing = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      firstName: 'Muhasebe',
      lastName: 'Ekibi',
      email: 'muhasebe@ailedis.com',
      role: 'billing',
      passwordHash,
    },
  });

  const dentists = await Promise.all([
    prisma.user.create({ data: { clinicId: clinic.id, firstName: 'Dt. Kerem', lastName: 'Özgüler', email: 'kerem.ozguler@ailedis.com', role: 'doctor', passwordHash } }),
    prisma.user.create({ data: { clinicId: clinic.id, firstName: 'Uzm. Dt. Hatice', lastName: 'Erkin', email: 'hatice.erkin@ailedis.com', role: 'doctor', passwordHash } }),
    prisma.user.create({ data: { clinicId: clinic.id, firstName: 'Dt. Ayşegül', lastName: 'Akmeşe', email: 'aysegul.akmese@ailedis.com', role: 'doctor', passwordHash } }),
    prisma.user.create({ data: { clinicId: clinic.id, firstName: 'Dt. Yasin', lastName: 'Turgut', email: 'yasin.turgut@ailedis.com', role: 'doctor', passwordHash } }),
    prisma.user.create({ data: { clinicId: clinic.id, firstName: 'Dt. Salim Fatih', lastName: 'Girgin', email: 'salim.girgin@ailedis.com', role: 'doctor', passwordHash } }),
    prisma.user.create({ data: { clinicId: clinic.id, firstName: 'Dt. Batıkan', lastName: 'Şirin', email: 'batikan.sirin@ailedis.com', role: 'doctor', passwordHash } }),
    prisma.user.create({ data: { clinicId: clinic.id, firstName: 'Dt. Uğur', lastName: 'Mester', email: 'ugur.mester@ailedis.com', role: 'doctor', passwordHash } }),
  ]);

  await prisma.doctorAvailability.createMany({
    data: dentists.flatMap((dentist, index) => {
      const weekdaySlots = [1, 2, 3, 4, 5].map(weekday => ({
        clinicId: clinic.id,
        practitionerId: dentist.id,
        weekday,
        startTime: index % 2 === 0 ? '09:00' : '10:00',
        endTime: index % 2 === 0 ? '17:30' : '18:00',
        isActive: true,
      }));
      const saturdaySlot = {
        clinicId: clinic.id,
        practitionerId: dentist.id,
        weekday: 6,
        startTime: '10:00',
        endTime: '14:00',
        isActive: index < 3,
      };
      return [...weekdaySlots, saturdaySlot];
    }),
  });

  const services = [
    {
      name: 'Estetik Diş Hekimliği',
      durationMinutes: 60,
      color: colors.pink,
      category: 'Estetik',
      basePrice: null,
      description: 'Gülüş tasarımı, zirkonyum kaplama ve beyazlatma gibi estetik odaklı planlamalar.',
    },
    {
      name: 'İmplant Tedavisi',
      durationMinutes: 60,
      color: colors.violet,
      category: 'Cerrahi',
      basePrice: null,
      description: 'Diş eksiklikleri için implant uygunluk görüşmesi ve tedavi planı hazırlığı.',
    },
    {
      name: 'Ağız, Diş ve Çene Cerrahisi',
      durationMinutes: 60,
      color: colors.red,
      category: 'Cerrahi',
      basePrice: null,
      description: 'Gömülü diş, çekim ve cerrahi işlem öncesi değerlendirme randevusu.',
    },
    {
      name: 'Ortodonti (Diş Teli)',
      durationMinutes: 45,
      color: colors.amber,
      category: 'Ortodonti',
      basePrice: null,
      description: 'Diş dizilimi, kapanış ve şeffaf plak/braket seçenekleri için ortodonti görüşmesi.',
    },
    {
      name: 'Endodonti (Kanal Tedavisi)',
      durationMinutes: 90,
      color: colors.blue,
      category: 'Endodonti',
      basePrice: null,
      description: 'Doğal dişi korumaya yönelik kanal tedavisi planlama ve uygulama randevusu.',
    },
    {
      name: 'Pedodonti (Çocuk Diş Hekimliği)',
      durationMinutes: 45,
      color: colors.green,
      category: 'Çocuk Diş Hekimliği',
      basePrice: null,
      description: 'Çocuk hastalar için koruyucu ve konfor odaklı diş hekimliği randevuları.',
    },
    {
      name: 'Periodontoloji (Diş Eti Tedavisi)',
      durationMinutes: 45,
      color: colors.teal,
      category: 'Diş Eti',
      basePrice: null,
      description: 'Diş eti kanaması, çekilme ve periodontal takip süreçleri.',
    },
    {
      name: 'Protetik Diş Tedavisi',
      durationMinutes: 75,
      color: colors.slate,
      category: 'Protetik',
      basePrice: null,
      description: 'Kron, köprü ve protez planlaması ile fonksiyon ve estetik geri kazanım süreçleri.',
    },
    {
      name: 'Kompozit Dolgu',
      durationMinutes: 45,
      color: colors.cyan,
      category: 'Restoratif',
      basePrice: null,
      description: 'Doğal diş görünümünü koruyan estetik ve dayanıklı dolgu uygulamaları.',
    },
    {
      name: 'Gülüş Tasarımı',
      durationMinutes: 60,
      color: colors.pink,
      category: 'Estetik',
      basePrice: null,
      description: 'Gülüş estetik beklentileri ve ağız sağlığı ihtiyaçlarını birlikte ele alan planlama.',
    },
    {
      name: 'Zirkonyum Kaplama',
      durationMinutes: 75,
      color: colors.orange,
      category: 'Estetik Protetik',
      basePrice: null,
      description: 'Doğal görünüm ve dayanıklılık hedefleyen zirkonyum kaplama planlama randevusu.',
    },
    {
      name: 'Diş Beyazlatma Bleaching',
      durationMinutes: 60,
      color: colors.blue,
      category: 'Estetik',
      basePrice: null,
      description: 'Diş renginin açılması için profesyonel beyazlatma değerlendirmesi ve uygulaması.',
    },
  ];

  const appointmentTypes = await Promise.all(
    services.map((service) =>
      prisma.appointmentType.create({
        data: {
          clinicId: clinic.id,
          name: service.name,
          durationMinutes: service.durationMinutes,
          color: service.color,
          category: service.category,
          description: service.description,
          basePrice: service.basePrice,
          currency: 'TRY',
          isService: true,
        },
      })
    )
  );

  const patients = await Promise.all([
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Mehmet', lastName: 'Aydin', email: 'mehmet.aydin@example.com', phone: '+90 532 100 00 01', patientStatus: 'active', source: 'google', communicationConsent: true } }),
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Zeynep', lastName: 'Sahin', email: 'zeynep.sahin@example.com', phone: '+90 532 100 00 02', patientStatus: 'active', source: 'website', communicationConsent: true, marketingConsent: true } }),
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Elif', lastName: 'Kaya', email: 'elif.kaya@example.com', phone: '+90 532 100 00 03', patientStatus: 'new', source: 'instagram', communicationConsent: true } }),
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Burak', lastName: 'Yilmaz', email: 'burak.yilmaz@example.com', phone: '+90 532 100 00 04', patientStatus: 'active', source: 'referral', communicationConsent: true } }),
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Selin', lastName: 'Demir', email: 'selin.demir@example.com', phone: '+90 532 100 00 05', patientStatus: 'active', source: 'phone', communicationConsent: true } }),
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Mert', lastName: 'Arslan', email: 'mert.arslan@example.com', phone: '+90 532 100 00 06', patientStatus: 'new', source: 'walk_in' } }),
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Derya', lastName: 'Ozturk', email: 'derya.ozturk@example.com', phone: '+90 532 100 00 07', patientStatus: 'active', source: 'google', communicationConsent: true } }),
    prisma.patient.create({ data: { clinicId: clinic.id, firstName: 'Can', lastName: 'Koc', email: 'can.koc@example.com', phone: '+90 532 100 00 08', patientStatus: 'inactive', source: 'website' } }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  await prisma.appointment.createMany({
    data: [
      {
        clinicId: clinic.id,
        patientId: patients[0].id,
        practitionerId: dentists[0].id,
        appointmentTypeId: appointmentTypes[1].id,
        title: 'Implant uygunluk gorusmesi',
        startTime: new Date(new Date(today).setHours(9, 0)),
        endTime: new Date(new Date(today).setHours(10, 0)),
        status: 'confirmed',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[1].id,
        practitionerId: dentists[1].id,
        appointmentTypeId: appointmentTypes[9].id,
        title: 'Gulus tasarimi gorusmesi',
        startTime: new Date(new Date(today).setHours(10, 30)),
        endTime: new Date(new Date(today).setHours(11, 30)),
        status: 'scheduled',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[2].id,
        practitionerId: dentists[2].id,
        appointmentTypeId: appointmentTypes[8].id,
        title: 'Kompozit dolgu randevusu',
        startTime: new Date(new Date(today).setHours(13, 0)),
        endTime: new Date(new Date(today).setHours(13, 45)),
        status: 'scheduled',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[3].id,
        practitionerId: dentists[3].id,
        appointmentTypeId: appointmentTypes[3].id,
        title: 'Ortodonti kontrol',
        startTime: new Date(new Date(today).setHours(15, 0)),
        endTime: new Date(new Date(today).setHours(15, 45)),
        status: 'confirmed',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[4].id,
        practitionerId: dentists[4].id,
        appointmentTypeId: appointmentTypes[4].id,
        title: 'Kanal tedavisi kontrol',
        startTime: new Date(new Date(yesterday).setHours(11, 0)),
        endTime: new Date(new Date(yesterday).setHours(12, 30)),
        status: 'completed',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[5].id,
        practitionerId: dentists[5].id,
        appointmentTypeId: appointmentTypes[11].id,
        title: 'Beyazlatma on gorusmesi',
        startTime: new Date(new Date(yesterday).setHours(16, 0)),
        endTime: new Date(new Date(yesterday).setHours(17, 0)),
        status: 'no_show',
        noShowReason: 'Hasta randevuya gelmedi.',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[6].id,
        practitionerId: dentists[6].id,
        appointmentTypeId: appointmentTypes[6].id,
        title: 'Dis eti tedavisi kontrol',
        startTime: new Date(new Date(tomorrow).setHours(10, 0)),
        endTime: new Date(new Date(tomorrow).setHours(10, 45)),
        status: 'scheduled',
        createdById: receptionist.id,
      },
    ],
  });

  const implantCase = await prisma.treatmentCase.create({
    data: {
      clinicId: clinic.id,
      patientId: patients[0].id,
      practitionerId: dentists[0].id,
      appointmentTypeId: appointmentTypes[1].id,
      title: 'Implant tedavi plani',
      description: 'Hasta icin implant tedavi sureci teklif asamasinda takip ediliyor.',
      stage: 'quote_sent',
      estimatedAmount: 45000,
      currency: 'TRY',
      createdById: receptionist.id,
    },
  });

  const smileCase = await prisma.treatmentCase.create({
    data: {
      clinicId: clinic.id,
      patientId: patients[1].id,
      practitionerId: dentists[1].id,
      appointmentTypeId: appointmentTypes[9].id,
      title: 'Gulus tasarimi sureci',
      description: 'Estetik beklenti ve tedavi planlamasi icin takip.',
      stage: 'in_progress',
      estimatedAmount: 32000,
      acceptedAmount: 30000,
      currency: 'TRY',
      createdById: receptionist.id,
    },
  });

  const orthoCase = await prisma.treatmentCase.create({
    data: {
      clinicId: clinic.id,
      patientId: patients[3].id,
      practitionerId: dentists[3].id,
      appointmentTypeId: appointmentTypes[3].id,
      title: 'Ortodonti takip sureci',
      stage: 'accepted',
      estimatedAmount: 60000,
      acceptedAmount: 58000,
      currency: 'TRY',
      createdById: admin.id,
    },
  });

  await prisma.payment.createMany({
    data: [
      {
        clinicId: clinic.id,
        patientId: patients[1].id,
        treatmentCaseId: smileCase.id,
        amount: 10000,
        currency: 'TRY',
        paymentMethod: 'card',
        paymentStatus: 'paid',
        paidAt: new Date(),
        createdById: billing.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[1].id,
        treatmentCaseId: smileCase.id,
        amount: 20000,
        currency: 'TRY',
        paymentMethod: 'bank_transfer',
        paymentStatus: 'pending',
        createdById: billing.id,
      },
      {
        clinicId: clinic.id,
        patientId: patients[3].id,
        treatmentCaseId: orthoCase.id,
        amount: 15000,
        currency: 'TRY',
        paymentMethod: 'cash',
        paymentStatus: 'partial',
        paidAt: new Date(),
        createdById: receptionist.id,
      },
    ],
  });

  await prisma.task.createMany({
    data: [
      {
        clinicId: clinic.id,
        patientId: patients[0].id,
        treatmentCaseId: implantCase.id,
        assignedToId: receptionist.id,
        createdById: admin.id,
        title: 'Implant teklifi icin hastayi ara',
        description: 'Teklif sonrasi karar durumunu ogren.',
        dueDate: new Date(new Date(today).setHours(17, 0)),
        priority: 'high',
        status: 'open',
      },
      {
        clinicId: clinic.id,
        patientId: patients[5].id,
        assignedToId: receptionist.id,
        createdById: admin.id,
        title: 'Gelmeyen hasta icin yeni randevu oner',
        description: 'Hassas tedavi detayi paylasmadan yeniden randevu teklif et.',
        dueDate: new Date(new Date(today).setHours(12, 0)),
        priority: 'normal',
        status: 'open',
      },
      {
        clinicId: clinic.id,
        patientId: patients[1].id,
        treatmentCaseId: smileCase.id,
        assignedToId: billing.id,
        createdById: admin.id,
        title: 'Bekleyen odeme durumunu kontrol et',
        dueDate: new Date(new Date(tomorrow).setHours(10, 0)),
        priority: 'normal',
        status: 'in_progress',
      },
    ],
  });

  await prisma.messageTemplate.createMany({
    data: [
      {
        clinicId: clinic.id,
        name: 'Randevu Onayi',
        channel: 'whatsapp',
        language: 'tr',
        body: 'Merhaba {{patient_name}}, {{clinic_name}} randevunuz {{appointment_date}} saat {{appointment_time}} icin olusturuldu. Randevunuza gelemeyecekseniz lutfen bize bilgi verin.',
        createdById: admin.id,
      },
      {
        clinicId: clinic.id,
        name: '24 Saat Randevu Hatirlatma',
        channel: 'sms',
        language: 'tr',
        body: 'Hatirlatma: {{clinic_name}} randevunuz yarin {{appointment_time}} saatindedir. Iptal veya degisiklik icin lutfen klinigimizle iletisime gecin.',
        createdById: admin.id,
      },
      {
        clinicId: clinic.id,
        name: 'Randevu Sonrasi Tesekkur',
        channel: 'whatsapp',
        language: 'tr',
        body: 'Merhaba {{patient_name}}, bugun {{clinic_name}} ziyaretiniz icin tesekkur ederiz. Sorulariniz icin bize ulasabilirsiniz.',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        name: 'Gelmeyen Hasta Yeniden Randevu',
        channel: 'whatsapp',
        language: 'tr',
        body: 'Merhaba {{patient_name}}, bugunku randevunuzda sizi goremedik. Size uygun yeni bir randevu planlamak icin bizimle iletisime gecebilirsiniz.',
        createdById: receptionist.id,
      },
      {
        clinicId: clinic.id,
        name: 'Tedavi Plani Takip',
        channel: 'email',
        language: 'tr',
        subject: 'Tedavi planiniz hakkinda',
        body: 'Merhaba {{patient_name}}, klinigimizde gorustugumuz tedavi planinizla ilgili sorulariniz varsa size yardimci olmaktan memnuniyet duyariz.',
        createdById: admin.id,
      },
      {
        clinicId: clinic.id,
        name: 'Odeme Hatirlatma',
        channel: 'whatsapp',
        language: 'tr',
        body: 'Merhaba {{patient_name}}, {{clinic_name}} kayitlarinda bekleyen odeme bakiyeniz gorunmektedir. Detayli bilgi icin klinigimizle iletisime gecebilirsiniz.',
        createdById: billing.id,
      },
    ],
  });

  await prisma.activityLog.createMany({
    data: [
      {
        clinicId: clinic.id,
        userId: receptionist.id,
        entityType: 'patient',
        entityId: patients[0].id,
        patientId: patients[0].id,
        action: 'created',
        description: 'Yeni hasta kaydi olusturuldu: Mehmet Aydin',
      },
      {
        clinicId: clinic.id,
        userId: admin.id,
        entityType: 'treatment_case',
        entityId: implantCase.id,
        treatmentCaseId: implantCase.id,
        patientId: patients[0].id,
        action: 'quote_sent',
        description: 'Implant tedavi plani teklif asamasina alindi.',
      },
      {
        clinicId: clinic.id,
        userId: billing.id,
        entityType: 'payment',
        entityId: smileCase.id,
        treatmentCaseId: smileCase.id,
        patientId: patients[1].id,
        action: 'payment_recorded',
        description: 'Gulus tasarimi sureci icin odeme kaydi olusturuldu.',
      },
    ],
  });

  console.log('--------------------------------------------------');
  console.log('AILE DIS DEMO DATA LOADED SUCCESSFULLY');
  console.log('--------------------------------------------------');
  console.log('Admin: admin@ailedis.com / password123');
  console.log('Reception: resepsiyon@ailedis.com / password123');
  console.log('Billing: muhasebe@ailedis.com / password123');
  console.log('Dentist example: kerem.ozguler@ailedis.com / password123');
  console.log('--------------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
