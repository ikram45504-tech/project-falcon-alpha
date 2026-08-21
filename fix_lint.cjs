const fs = require('fs');

const files = [
  'src/HotelBookingFlowV3.tsx',
  'src/MiscBookingFlowV3.tsx',
  'src/TicketBookingFlowV2.tsx',
  'src/TransportBookingFlowV3.tsx',
  'src/VisaBookingFlowV3.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  content = content.replace(/,\s*normalizeBookingUb/, '');
  content = content.replace(/normalizeBookingUb,\s*/, '');
  content = content.replace(/import\s*\{\s*normalizeBookingUb\s*\}\s*from\s*"\.\/bookingUb";\r?\n/, '');
  
  content = content.replace(/type\s+Mode\s*=\s*"FORM"\s*\|\s*"REGISTER";\r?\n/, '');
  content = content.replace(/function\s+localDate\(\)\s*\{[^}]+\}\r?\n/, '');

  fs.writeFileSync(file, content);
}

let pkg = fs.readFileSync('src/PackageBookingFlowV2.tsx', 'utf8');
pkg = pkg.replace(/import\s+BookingLifecycleCenter\s+from\s*"\.\/BookingLifecycleCenter";\r?\n/, '');
fs.writeFileSync('src/PackageBookingFlowV2.tsx', pkg);

console.log("Lint fix complete");
