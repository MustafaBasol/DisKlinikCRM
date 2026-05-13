import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

async function testIsolation() {
  console.log('Starting isolation test...');

  try {
    // 1. Login as Admin Clinic A
    const loginA = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@azuredental.com',
      password: 'password123'
    });
    const tokenA = loginA.data.token;
    const clinicIdA = loginA.data.user.clinic.id;
    console.log(`Logged in as Admin A. Clinic ID: ${clinicIdA}`);

    // 2. Login as Admin Clinic B
    const loginB = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@alpinehealth.com',
      password: 'password123'
    });
    const tokenB = loginB.data.token;
    const clinicIdB = loginB.data.user.clinic.id;
    console.log(`Logged in as Admin B. Clinic ID: ${clinicIdB}`);

    // 3. Try to fetch Clinic B's patients using Token A
    console.log('Testing cross-clinic patient access...');
    const patientsB = await axios.get(`${API_URL}/patients`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    const firstPatientB = patientsB.data[0];
    
    if (firstPatientB) {
      console.log(`Found Patient B: ${firstPatientB.firstName} (ID: ${firstPatientB.id})`);
      
      try {
        const stolenPatient = await axios.get(`${API_URL}/patients/${firstPatientB.id}`, {
          headers: { Authorization: `Bearer ${tokenA}` }
        });
        console.error('CRITICAL ERROR: Clinic A user accessed Clinic B patient!');
      } catch (err: any) {
        if (err.response?.status === 404 || err.response?.status === 403) {
          console.log('Success: Clinic A user denied access to Clinic B patient.');
        } else {
          console.error(`Unexpected error: ${err.message}`);
        }
      }
    }

    // 4. Try to fetch Clinic B's dashboard using Token A
    console.log('Testing cross-clinic dashboard access...');
    const statsA = await axios.get(`${API_URL}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    
    // The stats should only count Azure Dental data.
    // Azure has 1 patient, Alpine has 1 patient.
    if (statsA.data.stats.newPatientsMonth === 1) {
      console.log('Success: Dashboard stats are scoped correctly.');
    } else {
      console.error(`CRITICAL ERROR: Dashboard stats leaked! Count: ${statsA.data.stats.newPatientsMonth}`);
    }

    console.log('Isolation test completed.');
  } catch (err: any) {
    console.error(`Test failed: ${err.message}`);
  }
}

testIsolation();
