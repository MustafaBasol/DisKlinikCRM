UPDATE "AppointmentType" SET "name" = 'Estetik Diş Hekimliği' WHERE "name" = 'Estetik Dis Hekimligi';
UPDATE "AppointmentType" SET "name" = 'İmplant Tedavisi' WHERE "name" = 'Implant Tedavisi';
UPDATE "AppointmentType" SET "name" = 'Ağız, Diş ve Çene Cerrahisi' WHERE "name" = 'Agiz, Dis ve Cene Cerrahisi';
UPDATE "AppointmentType" SET "name" = 'Ortodonti (Diş Teli)' WHERE "name" = 'Ortodonti (Dis Teli)';
UPDATE "AppointmentType" SET "name" = 'Pedodonti (Çocuk Diş Hekimliği)', "category" = 'Çocuk Diş Hekimliği' WHERE "name" = 'Pedodonti (Cocuk Dis Hekimligi)';
UPDATE "AppointmentType" SET "name" = 'Periodontoloji (Diş Eti Tedavisi)', "category" = 'Diş Eti' WHERE "name" = 'Periodontoloji (Dis Eti Tedavisi)';
UPDATE "AppointmentType" SET "name" = 'Protetik Diş Tedavisi' WHERE "name" = 'Protetik Dis Tedavisi';
UPDATE "AppointmentType" SET "name" = 'Gülüş Tasarımı' WHERE "name" = 'Gulus Tasarimi';
UPDATE "AppointmentType" SET "name" = 'Diş Beyazlatma Bleaching' WHERE "name" = 'Dis Beyazlatma Bleaching';

UPDATE "User" SET "lastName" = 'Özgüler' WHERE "email" = 'kerem.ozguler@ailedis.com' AND "lastName" = 'Ozguler';
UPDATE "User" SET "firstName" = 'Dt. Ayşegül', "lastName" = 'Akmeşe' WHERE "email" = 'aysegul.akmese@ailedis.com' AND "firstName" = 'Dt. Aysegul';
UPDATE "User" SET "firstName" = 'Dt. Batıkan', "lastName" = 'Şirin' WHERE "email" = 'batikan.sirin@ailedis.com' AND "firstName" = 'Dt. Batikan';
UPDATE "User" SET "firstName" = 'Dt. Uğur' WHERE "email" = 'ugur.mester@ailedis.com' AND "firstName" = 'Dt. Ugur';
