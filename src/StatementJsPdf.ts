import { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry, VisaType } from "./db";
import type { StatementBookingSections } from "./StatementBookingData";

export type StatementPdfData = {
  company: Company;
  party: Party;
  accountDirection: string;
  fromDate: string;
  toDate: string;
  generatedOn: string;
  statementRef: string;
  openingBalance: number;
  bookingsDuringPeriod: number;
  paymentsDuringPeriod: number;
  closingBalance: number;
  pendingSarBalance: number;
  sections: StatementBookingSections;
  payments: PaymentEntry[];
};

type Align = "left" | "center" | "right";
type Column = { width: number; header: string; align?: Align };
type Cell = { text: string; secondary?: string; align?: Align; bold?: boolean };
type Theme = { dark: string; header: string; alt: string; subtotal: string };
type SectionSubtotal = { label: string; pkr?: number; sar?: number; pendingSar?: number };

const PAGE_W = 210;
const PAGE_BOTTOM = 286;
const FOOTER_Y = 291;
const MARGIN = 5;
const CONTENT_W = 200;

const COLORS = {
  navy: "#153F73", ink: "#25384D", muted: "#66788A", border: "#B9C6D3", white: "#FFFFFF",
  blueHeader: "#B8D1EA", blueAlt: "#F1F6FB", blueSubtotal: "#E6EEF7",
  purple: "#57258B", purpleHeader: "#DDC8EC", purpleAlt: "#F5EEF9", purpleSubtotal: "#EEE3F5",
  green: "#087B43", greenHeader: "#BFE2CE", greenAlt: "#F0F8F3", greenSubtotal: "#DDEFE5",
  red: "#B42939", redSoft: "#FCECEE", greyCard: "#EDF1F6", blueCard: "#EDF4FA", greenCard: "#EEF8F2", amberCard: "#FFF7E7",
};

const BOOKING_THEME: Theme = { dark: COLORS.navy, header: COLORS.blueHeader, alt: COLORS.blueAlt, subtotal: COLORS.blueSubtotal };
const PAYMENT_THEME: Theme = { dark: COLORS.purple, header: COLORS.purpleHeader, alt: COLORS.purpleAlt, subtotal: COLORS.purpleSubtotal };
const RECON_THEME: Theme = { dark: COLORS.green, header: COLORS.greenHeader, alt: COLORS.greenAlt, subtotal: COLORS.greenSubtotal };

function rgb(hex: string): [number, number, number] { const c = hex.replace("#", ""); return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)]; }
function fill(doc: jsPDF, hex: string) { doc.setFillColor(...rgb(hex)); }
function stroke(doc: jsPDF, hex: string) { doc.setDrawColor(...rgb(hex)); }
function textColor(doc: jsPDF, hex: string) { doc.setTextColor(...rgb(hex)); }
function money(value: number) { const n = Number(value || 0); const sign = n < 0 ? "-" : ""; return `${sign}Rs ${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
function sar(value: number) { return `SAR ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
function number(value: number) { return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function safeText(value: unknown) { const text = String(value ?? "").trim(); return text || "-"; }
function shortDate(value: string) { if (!value) return "-"; const [y,m,d] = value.split("-").map(Number); if (!y || !m || !d) return value; return new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"short" }).format(new Date(y,m-1,d)).replace(/ /g,"-"); }
function longDate(value: string) { if (!value) return "-"; const [y,m,d] = value.split("-").map(Number); if (!y || !m || !d) return value; return new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(y,m-1,d)).replace(/ /g,"-"); }
function imageFormat(dataUrl: string) { const type = (/^data:image\/([^;]+);/i.exec(dataUrl)?.[1] || "png").toLowerCase(); return type.includes("jpeg") || type.includes("jpg") ? "JPEG" : type.includes("webp") ? "WEBP" : "PNG"; }
function sum<T>(rows: T[], selector: (row: T) => number) { return rows.reduce((total,row) => total + Number(selector(row) || 0), 0); }
function titleCase(value: string) { return value.replace(/_/g," ").toLowerCase().replace(/\b\w/g,(c) => c.toUpperCase()); }
function flightTypeLabel(value: string) { return value === "ONE_WAY" ? "One Way" : value === "MULTI_CITY" ? "Multi-City" : "Return"; }
function visaTypeLabel(value: VisaType) { if (value === "ONLY_UMRAH_VISA") return "Only Umrah Visa"; if (value === "UMRAH_VISA_TRANSPORT") return "Umrah Visa + Transport"; if (value === "UMRAH_VISA_ONE_WAY_TRANSPORT") return "Umrah Visa + One-Way Transport"; return "Umrah Visa + Full Transport"; }

function drawHeader(doc: jsPDF, data: StatementPdfData) {
  let x = MARGIN; const top = 6;
  if (data.company.logo_data) { try { doc.addImage(data.company.logo_data, imageFormat(data.company.logo_data), x, top, 11, 11, undefined, "FAST"); x += 13.3; } catch { /* text branding remains */ } }
  doc.setFont("helvetica","bold"); doc.setFontSize(13.4); textColor(doc,COLORS.navy); doc.text(data.company.name,x,top+4.5);
  doc.setFont("helvetica","normal"); doc.setFontSize(5.1); textColor(doc,COLORS.ink); doc.text(safeText(data.company.address),x,top+9);
  const contacts = [data.company.phone,data.company.whatsapp,data.company.email].filter(Boolean).join("  |  "); if (contacts) { doc.setFontSize(4.2); textColor(doc,COLORS.muted); doc.text(contacts,x,top+12); }
  const directionTitle = data.party.account_type === "VENDOR" ? "PURCHASE / PAYABLE STATEMENT" : "SALE / RECEIVABLE STATEMENT";
  doc.setFont("helvetica","bold"); doc.setFontSize(11.5); textColor(doc,COLORS.navy); doc.text("STATEMENT OF ACCOUNT",PAGE_W-MARGIN,top+4,{align:"right"});
  doc.setFontSize(6.1); doc.text(directionTitle,PAGE_W-MARGIN,top+7.8,{align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(5.1); textColor(doc,COLORS.ink); doc.text(`Account: ${data.party.name}`,PAGE_W-MARGIN,top+11.2,{align:"right"}); doc.text(`Account Type: ${data.party.account_type}`,PAGE_W-MARGIN,top+14.1,{align:"right"});
  doc.text(`Statement Period: ${longDate(data.fromDate)} to ${longDate(data.toDate)}`,MARGIN,top+18.1);
  fill(doc,"#E8EDF3"); doc.roundedRect(MARGIN,top+19.3,61,5.1,1,1,"F"); doc.setFont("helvetica","bold"); doc.setFontSize(4.7); textColor(doc,COLORS.navy); doc.text(`Statement Ref: ${data.statementRef}`,MARGIN+2,top+22.5);
  doc.setFont("helvetica","normal"); doc.text(`Generated: ${data.generatedOn}`,PAGE_W-MARGIN,top+22.5,{align:"right"}); fill(doc,COLORS.navy); doc.rect(MARGIN,top+26,CONTENT_W,0.9,"F"); return top+29;
}

function drawSummary(doc: jsPDF, data: StatementPdfData, y: number) {
  const isVendor = data.party.account_type === "VENDOR";
  const cards = [
    { title:"OPENING BALANCE", value:money(data.openingBalance), foot:"Before selected period", bg:COLORS.greyCard, top:COLORS.navy },
    { title:isVendor?"PURCHASE BOOKINGS":"SALE BOOKINGS", value:money(data.bookingsDuringPeriod), foot:"PKR during period", bg:COLORS.blueCard, top:COLORS.navy },
    { title:"PAYMENTS", value:money(data.paymentsDuringPeriod), foot:"During selected period", bg:COLORS.greenCard, top:COLORS.green },
    { title:isVendor?"PAYABLE BALANCE":"RECEIVABLE BALANCE", value:money(data.closingBalance), foot:data.closingBalance<0?"Advance / overpayment":"Closing PKR position", bg:data.closingBalance>0?COLORS.redSoft:COLORS.greenCard, top:data.closingBalance>0?COLORS.red:COLORS.green },
    { title:"PENDING SAR", value:sar(data.pendingSarBalance), foot:"Awaiting ROE", bg:COLORS.amberCard, top:COLORS.navy },
  ];
  const gap=1.25,w=(CONTENT_W-gap*4)/5,h=15.5;
  cards.forEach((card,index)=>{ const x=MARGIN+index*(w+gap); fill(doc,card.bg); stroke(doc,COLORS.border); doc.roundedRect(x,y,w,h,1,1,"FD"); fill(doc,card.top); doc.rect(x,y,w,0.9,"F"); doc.setFont("helvetica","bold"); doc.setFontSize(4.15); textColor(doc,COLORS.muted); doc.text(card.title,x+1.6,y+4.1); doc.setFontSize(7.2); textColor(doc,card.top); doc.text(card.value,x+1.6,y+9.1); doc.setFont("helvetica","normal"); doc.setFontSize(3.7); textColor(doc,COLORS.muted); doc.text(card.foot,x+1.6,y+12.8); });
  return y+h+2.3;
}

function continuation(doc: jsPDF, data: StatementPdfData) { doc.addPage("a4","portrait"); doc.setFont("helvetica","bold"); doc.setFontSize(7); textColor(doc,COLORS.navy); doc.text(data.company.name,MARGIN,8); doc.setFont("helvetica","normal"); doc.setFontSize(4.7); textColor(doc,COLORS.muted); doc.text(`Statement - ${data.party.name}`,MARGIN,11.2); doc.text(`${data.statementRef} | ${longDate(data.fromDate)} to ${longDate(data.toDate)}`,PAGE_W-MARGIN,9.5,{align:"right"}); fill(doc,COLORS.navy); doc.rect(MARGIN,13.2,CONTENT_W,0.7,"F"); return 16; }
function textLines(doc: jsPDF,text:string,width:number,size=5.0,bold=false){doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);return doc.splitTextToSize(text||"-",Math.max(2,width-1.4)) as string[];}
function rowHeight(doc:jsPDF,cells:Cell[],columns:Column[]){return Math.max(5.2,...cells.map((cell,i)=>{const main=textLines(doc,cell.text,columns[i].width,5.0,!!cell.bold).length;const secondary=cell.secondary?textLines(doc,cell.secondary,columns[i].width,4.15).length:0;return main*2.05+secondary*1.75+1.3;}));}
function drawSectionTitle(doc:jsPDF,title:string,theme:Theme,y:number,continued=false){fill(doc,theme.dark);doc.rect(MARGIN,y,CONTENT_W,6.2,"F");doc.setFont("helvetica","bold");doc.setFontSize(7.1);textColor(doc,COLORS.white);doc.text(continued?`${title} - CONTINUED`:title,MARGIN+2,y+4.2);return y+6.2;}
function drawColumns(doc:jsPDF,columns:Column[],theme:Theme,y:number){const h=6.7;let x=MARGIN;fill(doc,theme.header);stroke(doc,COLORS.border);doc.rect(MARGIN,y,CONTENT_W,h,"FD");columns.forEach((col,i)=>{if(i)doc.line(x,y,x,y+h);doc.setFont("helvetica","bold");doc.setFontSize(4.2);textColor(doc,COLORS.ink);col.header.split("\n").forEach((line,li)=>doc.text(line,x+col.width/2,y+2.7+li*1.7,{align:"center"}));x+=col.width;});return y+h;}
function drawRow(doc:jsPDF,cells:Cell[],columns:Column[],y:number,h:number,alt?:string){let x=MARGIN;if(alt){fill(doc,alt);doc.rect(MARGIN,y,CONTENT_W,h,"F");}stroke(doc,COLORS.border);doc.rect(MARGIN,y,CONTENT_W,h);cells.forEach((cell,i)=>{const w=columns[i].width,align=cell.align||columns[i].align||"left";if(i)doc.line(x,y,x,y+h);const main=textLines(doc,cell.text,w,5.0,!!cell.bold);const secondary=cell.secondary?textLines(doc,cell.secondary,w,4.15):[];const blockH=main.length*2.05+secondary.length*1.75;let ty=y+Math.max(0.7,(h-blockH)/2)+1.8;doc.setFont("helvetica",cell.bold?"bold":"normal");doc.setFontSize(5.0);textColor(doc,COLORS.ink);main.forEach((line,li)=>doc.text(line,align==="right"?x+w-0.7:align==="center"?x+w/2:x+0.7,ty+li*2.05,{align}));ty+=main.length*2.05;if(secondary.length){doc.setFont("helvetica","normal");doc.setFontSize(4.15);textColor(doc,COLORS.muted);secondary.forEach((line,li)=>doc.text(line,align==="right"?x+w-0.7:align==="center"?x+w/2:x+0.7,ty+li*1.75,{align}));}x+=w;});return y+h;}
function subtotalText(subtotal:SectionSubtotal){const parts:string[]=[];if(subtotal.sar!=null&&subtotal.sar!==0)parts.push(sar(subtotal.sar));if(subtotal.pkr!=null)parts.push(money(subtotal.pkr));if(subtotal.pendingSar)parts.push(`Pending ${sar(subtotal.pendingSar)}`);return parts.join(" | ");}
function drawSubtotal(doc:jsPDF,subtotal:SectionSubtotal,theme:Theme,y:number){const h=5.8;fill(doc,theme.subtotal);stroke(doc,COLORS.border);doc.rect(MARGIN,y,CONTENT_W,h,"FD");fill(doc,theme.dark);doc.rect(MARGIN,y,CONTENT_W,0.65,"F");doc.setFont("helvetica","bold");doc.setFontSize(5.0);textColor(doc,theme.dark);doc.text(subtotal.label,PAGE_W-MARGIN-77,y+3.9,{align:"right"});textColor(doc,COLORS.navy);doc.text(subtotalText(subtotal),PAGE_W-MARGIN-2,y+3.9,{align:"right"});return y+h+2.4;}
function renderSection(doc:jsPDF,data:StatementPdfData,title:string,columns:Column[],rows:Cell[][],subtotal:SectionSubtotal,theme:Theme,y:number){if(!rows.length)return y;const min=6.2+6.7+rowHeight(doc,rows[0],columns)+5.8;if(y+min>PAGE_BOTTOM)y=continuation(doc,data);y=drawSectionTitle(doc,title,theme,y);y=drawColumns(doc,columns,theme,y);rows.forEach((row,index)=>{const h=rowHeight(doc,row,columns),reserve=index===rows.length-1?5.8:0;if(y+h+reserve>PAGE_BOTTOM){y=continuation(doc,data);y=drawSectionTitle(doc,title,theme,y,true);y=drawColumns(doc,columns,theme,y);}y=drawRow(doc,row,columns,y,h,index%2?theme.alt:undefined);});return drawSubtotal(doc,subtotal,theme,y);}

function drawReconciliation(doc:jsPDF,data:StatementPdfData,y:number){const s=data.sections;const serviceRows:Array<[string,number]>=[["Package Bookings",sum(s.packageBookings,r=>r.total_pkr)],["Ticket Bookings",sum(s.ticketBookings,r=>r.total_pkr)],["Hotel Bookings (converted PKR)",sum(s.hotelBookings,r=>r.total_pkr)],["Visa Bookings",sum(s.visaBookings,r=>r.total_pkr)],["Transport Bookings",sum(s.transportBookings,r=>r.total_pkr)],["Misc Bookings",sum(s.miscBookings,r=>r.total_pkr)]];const h=5.6,required=6.2+(serviceRows.length+5)*h+7;if(y+required>PAGE_BOTTOM)y=continuation(doc,data);y=drawSectionTitle(doc,"FINAL RECONCILIATION",RECON_THEME,y);const rows:Array<[string,string,string?]>=[...serviceRows.map(([label,value])=>[label,money(value)] as [string,string]),["TOTAL BOOKING AMOUNT",money(data.bookingsDuringPeriod),"total"],["LESS: PAYMENTS",`- ${money(data.paymentsDuringPeriod)}`],["ADD: OPENING BALANCE",money(data.openingBalance)],[data.party.account_type==="VENDOR"?"CLOSING PAYABLE":"CLOSING RECEIVABLE",money(data.closingBalance),"closing"],["PENDING SAR CONVERSION",sar(data.pendingSarBalance),"pending"]];rows.forEach(([label,value,kind],index)=>{const bg=kind==="total"?COLORS.blueSubtotal:kind==="closing"?COLORS.greenSubtotal:kind==="pending"?COLORS.amberCard:index%2?COLORS.greenAlt:COLORS.white;fill(doc,bg);stroke(doc,COLORS.border);doc.rect(MARGIN,y,CONTENT_W,h,"FD");doc.setFont("helvetica",kind?"bold":"normal");doc.setFontSize(5.2);textColor(doc,COLORS.ink);doc.text(label,MARGIN+2,y+3.7);doc.setFont("helvetica","bold");textColor(doc,kind==="closing"?COLORS.green:COLORS.navy);doc.text(value,PAGE_W-MARGIN-2,y+3.7,{align:"right"});y+=h;});const note="Operational/private details such as passport numbers, visa numbers, driver mobile numbers, vehicle plates and internal instructions are intentionally excluded from this financial statement.";if(y+8>PAGE_BOTTOM)y=continuation(doc,data);doc.setFont("helvetica","normal");doc.setFontSize(4.2);textColor(doc,COLORS.muted);const lines=doc.splitTextToSize(note,CONTENT_W-4) as string[];lines.forEach((line,index)=>doc.text(line,MARGIN+2,y+3+index*1.8));return y+4+lines.length*1.8;}
function drawFooters(doc:jsPDF,data:StatementPdfData){const pages=doc.getNumberOfPages();for(let page=1;page<=pages;page+=1){doc.setPage(page);fill(doc,COLORS.navy);doc.rect(MARGIN,FOOTER_Y-3.3,CONTENT_W,0.55,"F");doc.setFont("helvetica","normal");doc.setFontSize(4.2);textColor(doc,COLORS.muted);doc.text(`${data.party.name} | ${data.statementRef}`,MARGIN,FOOTER_Y);doc.text(`Page ${page} of ${pages}`,PAGE_W-MARGIN,FOOTER_Y,{align:"right"});}}

export function buildStatementPdf(data:StatementPdfData){
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true,putOnlyUsedFonts:true});doc.setProperties({title:`${data.company.name} - Statement - ${data.party.name}`,subject:`Statement of Account - ${data.party.name}`,author:data.company.name,creator:"Travel Accounting"});let y=drawHeader(doc,data);y=drawSummary(doc,data,y);

  const packageColumns:Column[]=[{width:7,header:"SR",align:"center"},{width:23,header:"DATE / UB",align:"center"},{width:36,header:"PASSENGER / FAMILY"},{width:42,header:"PAX TYPE / PACKAGE"},{width:26,header:"RATE / PAX",align:"right"},{width:12,header:"QTY",align:"center"},{width:54,header:"TOTAL PKR",align:"right"}];const packageRows:Cell[][]=[];data.sections.packageBookings.forEach(b=>b.lines.forEach(l=>packageRows.push([{text:String(packageRows.length+1),align:"center"},{text:shortDate(b.transaction_date),secondary:b.ub_number,align:"center",bold:true},{text:safeText(l.passenger_name),bold:true},{text:l.passenger_type,secondary:safeText(l.package_type)},{text:money(l.rate_per_person),align:"right"},{text:String(Number(l.person_count||1)),align:"center"},{text:money(l.line_total_pkr),align:"right",bold:true}])));y=renderSection(doc,data,"PACKAGE BOOKINGS",packageColumns,packageRows,{label:"PACKAGE SUBTOTAL",pkr:sum(data.sections.packageBookings,r=>r.total_pkr)},BOOKING_THEME,y);

  const ticketColumns:Column[]=[{width:7,header:"SR",align:"center"},{width:22,header:"DATE / UB",align:"center"},{width:31,header:"PASSENGER"},{width:34,header:"AIRLINE / PNR"},{width:40,header:"ROUTE / TYPE"},{width:22,header:"RATE",align:"right"},{width:10,header:"QTY",align:"center"},{width:34,header:"TOTAL PKR",align:"right"}];const ticketRows:Cell[][]=[];data.sections.ticketBookings.forEach(b=>b.lines.forEach(l=>ticketRows.push([{text:String(ticketRows.length+1),align:"center"},{text:shortDate(b.transaction_date),secondary:b.ub_number,align:"center",bold:true},{text:safeText(l.passenger_name),secondary:l.passenger_type,bold:true},{text:safeText(l.airline_name),secondary:l.pnr?`PNR: ${l.pnr}`:"PNR: -"},{text:safeText(l.ticket_route),secondary:flightTypeLabel(l.flight_type)},{text:money(l.rate_per_ticket),align:"right"},{text:String(Number(l.ticket_count||1)),align:"center"},{text:money(l.line_total_pkr),align:"right",bold:true}])));y=renderSection(doc,data,"TICKET BOOKINGS",ticketColumns,ticketRows,{label:"TICKET SUBTOTAL",pkr:sum(data.sections.ticketBookings,r=>r.total_pkr)},BOOKING_THEME,y);

  const hotelColumns:Column[]=[{width:7,header:"SR",align:"center"},{width:22,header:"DATE / UB",align:"center"},{width:40,header:"GUEST / HOTEL"},{width:28,header:"STAY"},{width:24,header:"ROOM"},{width:32,header:"RATE / ROE"},{width:22,header:"TOTAL SAR",align:"right"},{width:25,header:"TOTAL PKR",align:"right"}];const hotelRows:Cell[][]=[];data.sections.hotelBookings.forEach(b=>b.lines.forEach((l,i)=>hotelRows.push([{text:String(hotelRows.length+1),align:"center"},{text:shortDate(b.transaction_date),secondary:b.ub_number,align:"center",bold:true},{text:safeText(b.guestRefs[i]||b.guest_family_name),secondary:`${safeText(l.hotel_name)} - ${safeText(l.city)}`,bold:true},{text:`${shortDate(l.check_in)} to ${shortDate(l.check_out)}`,secondary:`${number(l.nights)} Nights`},{text:titleCase(l.room_type),secondary:`${number(l.quantity)} ${l.room_type==="SHARING"?"Bed(s)":"Room(s)"}`},{text:`${sar(l.rate_per_night_sar)} / Night`,secondary:Number(l.roe||0)>0?`ROE ${number(l.roe)}`:"ROE Pending"},{text:sar(l.line_total_sar),align:"right"},{text:Number(l.roe||0)>0?money(l.line_total_pkr):"Pending",align:"right",bold:true}])));y=renderSection(doc,data,"HOTEL BOOKINGS",hotelColumns,hotelRows,{label:"HOTEL SUBTOTAL",sar:sum(data.sections.hotelBookings,r=>r.total_sar),pkr:sum(data.sections.hotelBookings,r=>r.total_pkr),pendingSar:sum(data.sections.hotelBookings,r=>r.unconverted_sar)},BOOKING_THEME,y);

  const visaColumns:Column[]=[{width:7,header:"SR",align:"center"},{width:22,header:"DATE / UB",align:"center"},{width:32,header:"PASSENGER / FAMILY"},{width:38,header:"VISA SERVICE"},{width:10,header:"PAX",align:"center"},{width:37,header:"VISA / TRANSPORT"},{width:12,header:"ROE",align:"right"},{width:20,header:"TOTAL SAR",align:"right"},{width:22,header:"TOTAL PKR",align:"right"}];const visaRows:Cell[][]=[];data.sections.visaBookings.forEach(b=>b.lines.forEach(l=>{const transportSar=Number(l.private_transport_allocated_sar||0)+Number(l.intercity_bus_total_sar||0);visaRows.push([{text:String(visaRows.length+1),align:"center"},{text:shortDate(b.transaction_date),secondary:b.ub_number,align:"center",bold:true},{text:safeText(l.passenger_name),secondary:l.passenger_type,bold:true},{text:visaTypeLabel(l.visa_type)},{text:String(Number(l.pax_count||0)),align:"center"},{text:`Visa ${sar(l.visa_rate_sar)} / Pax`,secondary:transportSar>0?`Transport ${sar(transportSar)}`:"Transport -"},{text:Number(l.roe||0)>0?number(l.roe):"Pending",align:"right"},{text:sar(l.line_total_sar),align:"right"},{text:Number(l.roe||0)>0?money(l.line_total_pkr):"Pending",align:"right",bold:true}]);}));y=renderSection(doc,data,"VISA BOOKINGS",visaColumns,visaRows,{label:"VISA SUBTOTAL",sar:sum(data.sections.visaBookings,r=>r.total_sar),pkr:sum(data.sections.visaBookings,r=>r.total_pkr),pendingSar:sum(data.sections.visaBookings,r=>r.unconverted_sar)},BOOKING_THEME,y);

  const transportColumns:Column[]=[{width:7,header:"SR",align:"center"},{width:22,header:"DATE / UB",align:"center"},{width:40,header:"SECTOR"},{width:32,header:"TRANSPORT / VEHICLE"},{width:24,header:"QTY / PAX"},{width:32,header:"RATE / ROE"},{width:20,header:"TOTAL SAR",align:"right"},{width:23,header:"TOTAL PKR",align:"right"}];const transportRows:Cell[][]=[];data.sections.transportBookings.forEach(b=>b.lines.forEach(l=>{const sharing=l.transport_type==="SHARING_BUS",vehicle=sharing?"Sharing Bus":safeText(l.custom_vehicle_name||titleCase(l.vehicle_type));transportRows.push([{text:String(transportRows.length+1),align:"center"},{text:shortDate(b.transaction_date),secondary:b.ub_number,align:"center",bold:true},{text:`${safeText(l.from_location)} -> ${safeText(l.to_location)}`,secondary:longDate(l.transport_date),bold:true},{text:sharing?"Sharing Bus":"Private Vehicle",secondary:vehicle},{text:sharing?`${number(l.pax_count)} Pax`:`${number(l.vehicle_count)} Vehicle(s)`,secondary:sharing?undefined:`${number(l.pax_count)} Pax`},{text:`${sar(l.rate_sar)} / ${sharing?"Pax":"Vehicle"}`,secondary:Number(l.roe||0)>0?`ROE ${number(l.roe)}`:"ROE Pending"},{text:sar(l.line_total_sar),align:"right"},{text:Number(l.roe||0)>0?money(l.line_total_pkr):"Pending",align:"right",bold:true}]);}));y=renderSection(doc,data,"TRANSPORT BOOKINGS",transportColumns,transportRows,{label:"TRANSPORT SUBTOTAL",sar:sum(data.sections.transportBookings,r=>r.total_sar),pkr:sum(data.sections.transportBookings,r=>r.total_pkr),pendingSar:sum(data.sections.transportBookings,r=>r.unconverted_sar)},BOOKING_THEME,y);

  const miscColumns:Column[]=[{width:7,header:"SR",align:"center"},{width:22,header:"DATE / UB",align:"center"},{width:34,header:"SERVICE"},{width:36,header:"FAMILY HEAD"},{width:10,header:"PAX",align:"center"},{width:39,header:"RATE / ROE"},{width:22,header:"TOTAL SAR",align:"right"},{width:30,header:"TOTAL PKR",align:"right"}];const miscRows:Cell[][]=[];data.sections.miscBookings.forEach(b=>b.lines.forEach((l,i)=>miscRows.push([{text:String(miscRows.length+1),align:"center"},{text:shortDate(b.transaction_date),secondary:b.ub_number,align:"center",bold:true},{text:safeText(l.service_name),bold:true},{text:safeText(b.familyHeads[i])},{text:String(Number(l.pax_count||0)),align:"center"},{text:`${l.currency_mode} ${number(l.rate_per_person)} / Person`,secondary:l.currency_mode==="SAR"?`ROE ${number(l.roe)}`:"PKR direct"},{text:l.currency_mode==="SAR"?sar(l.line_total_sar):"-",align:"right"},{text:money(l.line_total_pkr),align:"right",bold:true}])));y=renderSection(doc,data,"MISC BOOKINGS",miscColumns,miscRows,{label:"MISC SUBTOTAL",sar:sum(data.sections.miscBookings,r=>r.total_sar),pkr:sum(data.sections.miscBookings,r=>r.total_pkr),pendingSar:sum(data.sections.miscBookings,r=>r.unconverted_sar)},BOOKING_THEME,y);

  const paymentColumns:Column[]=[{width:7,header:"SR",align:"center"},{width:22,header:"DATE",align:"center"},{width:24,header:"RECEIPT #"},{width:30,header:"FROM"},{width:32,header:"TO"},{width:43,header:"DESCRIPTION"},{width:14,header:"TYPE",align:"center"},{width:28,header:"PAID PKR",align:"right"}];const paymentRows:Cell[][]=data.payments.map((e,i)=>[{text:String(i+1),align:"center"},{text:longDate(e.transaction_date),align:"center"},{text:safeText(e.receipt_no),bold:true},{text:safeText(e.from_account)},{text:safeText(e.to_account)},{text:safeText(e.description)},{text:safeText(e.payment_type),align:"center"},{text:money(e.paid_amount),secondary:e.currency==="SAR"?`${sar(e.sar)} @ ${number(e.roe)}`:undefined,align:"right",bold:true}]);y=renderSection(doc,data,"PAYMENTS",paymentColumns,paymentRows,{label:"PAYMENTS SUBTOTAL",pkr:data.paymentsDuringPeriod},PAYMENT_THEME,y);

  drawReconciliation(doc,data,y);drawFooters(doc,data);return doc;
}
