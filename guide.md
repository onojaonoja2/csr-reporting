
### **Save the entire block below as guide.md**

Markdown  
\# Master Blueprint & Specification: Elkris CSR Reporting Interface

This document serves as the single source of truth for the development, architecture, business logic, and UI design of the Elkris CSR Reporting Interface. It contains all exact configurations, data models, and scripts required by the CLI coding agent.

\---

\#\# 1\. Directory Structure Blueprint

The CLI Agent must generate the codebase following this exact layout to ensure proper separation of concerns:

\`\`\`text  
elkris-csr-reporting/  
├── config/  
│   └── nigeriaGeopoliticalData.js  \# Geopolitical zone & state mapping arrays  
├── data/  
│   ├── users.json                 \# Credentials, roles, profiles, and theme flags  
│   ├── stock.json                 \# Inventory tracking by product and grammage  
│   └── sales.json                 \# Daily metrics, targets, and active attendance logs  
├── middleware/  
│   └── auth.js                    \# Strict Session Role-Based Access Control (RBAC)  
├── public/  
│   ├── css/  
│   │   └── style.css              \# Custom Tailwind utility rules & CSS overrides  
│   └── js/  
│       └── themeEngine.js         \# Client-side theme persistence execution script  
├── routes/  
│   ├── auth.js                    \# Authentication, login, and self password updates  
│   ├── admin.js                   \# Administrative actions & user CRUD management  
│   ├── supervisor.js              \# Performance targets, daily sales entries, stock updates  
│   └── manager.js                 \# Financial review and management macro views  
├── views/                         \# EJS Presentation Templates  
│   ├── partials/  
│   │   ├── header.ejs             \# Dynamic navigation bar with Dark/Light mode switch  
│   │   ├── sidebar.ejs            \# Role-scoped dynamic sidebar navigation links  
│   │   └── footer.ejs  
│   ├── admin/  
│   │   └── dashboard.ejs          \# User directory control console  
│   ├── supervisor/  
│   │   ├── dashboard.ejs          \# Target modifications and daily sales logger  
│   │   └── inventory.ejs          \# Allocation management board  
│   ├── manager/  
│   │   ├── dashboard.ejs          \# Remuneration calculation matrix  
│   │   └── aggregateView.ejs      \# Chronological historical metrics console  
│   └── index.ejs                  \# Clean enterprise brand portal landing and login UI  
├── server.js                      \# Central Express Application Gateway  
└── package.json                   \# Dependencies manifest and start script configurations

## **2\. Core Technical Dependencies & Configuration**

The application must operate within a stable Node.js runtime environment using these specific packages:

JSON  
{  
  "name": "elkris-csr-reporting",  
  "version": "1.0.0",  
  "description": "Elkris CSR Performance and Inventory Interface",  
  "main": "server.js",  
  "scripts": {  
    "start": "node server.js",  
    "dev": "nodemon server.js"  
  },  
  "dependencies": {  
    "express": "^4.19.0",  
    "ejs": "^3.1.10",  
    "express-session": "^1.18.0",  
    "bcryptjs": "^2.4.3"  
  }  
}

## **3\. Data Map: Geopolitical Zones, States, and LGAs of Nigeria**

Save this exact object profile into config/nigeriaGeopoliticalData.js. The registration and CSR creation views must enforce cascading dropdown menus based directly on this geopolitical mapping:

JavaScript  
const nigeriaGeopoliticalData \= {  
  "North Central": {  
    "Benue": \["Makurdi", "Gboko", "Oturkpo", "Katsina-Ala", "Vandeikya"\],  
    "Kogi": \["Lokoja", "Okene", "Idah", "Ankpa", "Kabba"\],  
    "Kwara": \["Ilorin West", "Ilorin East", "Ilorin South", "Offa", "Edu"\],  
    "Nasarawa": \["Lafia", "Keffi", "Akwanga", "Nasarawa", "Karu"\],  
    "Niger": \["Minna", "Bida", "Suleja", "Kontagora", "Chanchaga"\],  
    "Plateau": \["Jos North", "Jos South", "Barkin Ladi", "Pankshin", "Shendam"\],  
    "FCT": \["Abuja Municipal", "Bwari", "Gwagwalada", "Kuje", "Kwali", "Abaji"\]  
  },  
  "North East": {  
    "Adamawa": \["Yola North", "Yola South", "Mubi North", "Jimeta", "Numan"\],  
    "Bauchi": \["Bauchi", "Azare", "Misau", "Katagum", "Tafawa Balewa"\],  
    "Borno": \["Maiduguri", "Biu", "Jere", "Gwoza", "Bama"\],  
    "Gombe": \["Gombe", "Dukku", "Kaltungo", "Billiri", "Akko"\],  
    "Taraba": \["Jalingo", "Wukari", "Bali", "Gashaka", "Sardauna"\],  
    "Yobe": \["Damaturu", "Potiskum", "Gashua", "Nguru", "Geidam"\]  
  },  
  "North West": {  
    "Jigawa": \["Dutse", "Hadejia", "Gumel", "Ringim", "Kazaure"\],  
    "Kaduna": \["Kaduna North", "Kaduna South", "Zaria", "Sabon Gari", "Kafanchan"\],  
    "Kano": \["Kano Municipal", "Fagge", "Dala", "Gwale", "Nassarawa"\],  
    "Katsina": \["Katsina", "Funtua", "Daura", "Dutsin-Ma", "Malumfashi"\],  
    "Kebbi": \["Birnin Kebbi", "Argungu", "Yauri", "Zuru", "Jega"\],  
    "Sokoto": \["Sokoto North", "Sokoto South", "Wamako", "Tambuwal", "Gwadabawa"\],  
    "Zamfara": \["Gusau", "Kaura Namoda", "Tsafe", "Talata Mafara", "Anka"\]  
  },  
  "South East": {  
    "Abia": \["Umuahia North", "Aba North", "Aba South", "Ohafia", "Arochukwu"\],  
    "Anambra": \["Awka South", "Onitsha North", "Onitsha South", "Nnewi North", "Aguata"\],  
    "Ebonyi": \["Abakaliki", "Afikpo North", "Onueke", "Ezza North", "Ikwo"\],  
    "Enugu": \["Enugu North", "Enugu South", "Nsukka", "Oji River", "Udi"\],  
    "Imo": \["Owerri Municipal", "Owerri West", "Orlu", "Okigwe", "Mbaitoli"\]  
  },  
  "South South": {  
    "Akwa Ibom": \["Uyo", "Eket", "Ikot Ekpene", "Oron", "Ibeno"\],  
    "Bayelsa": \["Yenagoa", "Brass", "Ogbia", "Sagbama", "Ekeremor"\],  
    "Cross River": \["Calabar Municipal", "Calabar South", "Ikom", "Ogoja", "Obudu"\],  
    "Delta": \["Asaba", "Warri South", "Warri North", "Uvwie", "Sapele"\],  
    "Edo": \["Oredo", "Ikpoba Okha", "Egor", "Uromi", "Auchi"\],  
    "Rivers": \["Port Harcourt", "Obio-Akpor", "Bonny", "Eleme", "Ikwerre"\]  
  },  
  "South West": {  
    "Ekiti": \["Ado Ekiti", "Ikere", "Oye", "Ikole", "Ijero"\],  
    "Lagos": \["Ikeja", "Lagos Island", "Alimosho", "Surulere", "Ikorodu", "Badagry"\],  
    "Ogun": \["Abeokuta South", "Ijebu Ode", "Sagamu", "Ota", "Ilaro"\],  
    "Ondo": \["Akure North", "Akure South", "Ondo West", "Owo", "Ikare"\],  
    "Osun": \["Osogbo", "Ile-Ife", "Ilesa East", "Ede North", "Iwo"\],  
    "Oyo": \["Ibadan North", "Ibadan South-West", "Ogbomosho North", "Oyo East", "Saki"\]  
  }  
};

module.exports \= nigeriaGeopoliticalData;

## **4\. Operational Boundaries & User Privilege Tiers**

The application maintains explicit access partitions across four specific designations (Admin, Manager, Supervisor, CSR/Stockist).

| Module Task Action | Admin | Supervisor | Manager |
| :---- | :---- | :---- | :---- |
| Account Structure CRUD Operations | ✅ | ❌ | ❌ |
| Create & Onboard CSRs Profiles (Dynamic Location Dropdowns) | ✅ | ✅ | ✅ |
| Configure & Alter Base Operational Sales Targets | ❌ | ✅ | ❌ |
| Commit Daily Sales Input Volume / Attendance Tracking | ❌ | ✅ | ❌ |
| Review Performance Dashboards (Aggregated Views) | ✅ | ✅ | ✅ |
| Adjust Inventory / Bulk Batch Stock Updates | ❌ | ✅ | ❌ |
| Adjust Stockist/CSR Status (Active / Inactive Toggle) | ❌ | ✅ | ✅ |
| Process Compensation & Remuneration Disbursal Reports | ❌ | ✅ | ✅ |

### **Credentials Control & Overwrite Logic:**

1. **User Profile Updates (Self-Service):** Users modifying their passwords via standard route requests must provide their current password. The engine validates the hash state in users.json via bcryptjs.compareSync() before committing updates.  
2. **Administrative Override Updates:** When the Admin user updates accounts from the admin subview panel, an optional field labeled Force Reset Password is provided. If populated, the system skips all current validation loops and writes the new hash value directly to users.json:  
   JavaScript  
   if (req.body.forcedPassword && req.body.forcedPassword.trim().length \> 0) {  
       userRecord.password \= bcrypt.hashSync(req.body.forcedPassword.trim(), 10);  
   }

## **5\. Calculations Layer & Core Business Logic**

### **A. Target Attainment Performance Engine**

Aggregations must render uniformly across specific chronological slices: **Daily**, **Weekly**, and **Monthly**. The dashboard updates dynamically using the following target execution formula:

$$\\text{Target Reach Value (\\%)} \= \\left( \\frac{\\text{Logged Volume Discharged}}{\\text{Configured Operational Target}} \\right) \\times 100$$

### **B. Automated Inventory Maintenance Loop**

* Inventory records must be tracked explicitly by context labels and structural mass identifiers (e.g., *Product Name: "Elkris Premium Oats"*, *Grammage: "500g"*).  
* **Automatic Stock Deduction Hook:** When a Supervisor logs an explicit entry for daily product units sold, the system triggers a mathematical transactional recalculation event:  
  $$\\text{New Held Stock} \= \\text{Current Held Stock} \- \\text{Logged Volume Discharged}$$  
  *Note: The calculation must be processed inside a synchronized blocking queue or transaction handler to safeguard data accuracy.*

### **C. Attendance & Payout Calculator Engine**

When active states are monitored, the processing utility loops through the monthly sales database, checking for true attendance metrics (isPresent \= true) to count active execution days.

* **Remuneration Formula Configuration:**  
  $$\\text{Total Monthly Payout} \= \\text{Base Pay} \+ (\\text{Total Units Sold} \\times \\text{Per-Product Bonus}) \+ \\text{Volume Tier Incentives}$$  
* **System Control Configuration:** Base Pay arrays, unit bonus weights, and tiered performance limits must remain fully editable through parameter interfaces accessible to Supervisors and Managers.

## **6\. Theme Infrastructure Strategy (Light/Dark Bio-Health Scheme)**

The layout features a premium health food theme, utilizing clean semantic utility classes to remain highly scannable under both style choices.


Light Mode System Architecture Configuration  
├── Base Frame Background : Pure Crisp Crystal (\#ffffff) or Pale Neutral Smoke (\#f8f9fa)  
├── Brand Focal Headers    : Organic Forest Spruce (\#1b4332)  
├── Interactive Surfaces   : Pale Bio Mint (\#d8f3dc)  
└── Primary Core Text      : Deep Charcoal Onyx (\#212529)

Dark Mode System Architecture Configuration  
├── Base Frame Background : Deep Botanical Night (\#0b1c15)  
├── Brand Focal Headers    : Bright Emerald Mint (\#52b788)  
├── Interactive Surfaces   : Deep Velvet Moss (\#1b4332)  
└── Primary Core Text      : Soft Silver Cloud (\#e9ecef)

### **Flash-Free Theme Toggle Script (views/partials/header.ejs):**

To prevent bright flashes during layout rendering on initialization, the agent must embed this client-side block directly inside the Document layout:

HTML  
\<script\>  
  (function() {  
    const savedTheme \= localStorage.getItem('elkris-theme');  
    if (savedTheme \=== 'dark' || (\!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {  
      document.documentElement.classList.add('dark');  
    } else {  
      document.documentElement.classList.remove('dark');  
    }  
  })();  
\</script\>

The matching control switch must run an explicit functional override that swaps Document configurations and syncs state parameters instantaneously:

JavaScript  
function toggleSystemTheme() {  
  const isDark \= document.documentElement.classList.toggle('dark');  
  localStorage.setItem('elkris-theme', isDark ? 'dark' : 'light');  
}  
