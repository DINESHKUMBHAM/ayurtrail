CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(30) CHECK (role IN ('ADMIN', 'PI', 'CRC', 'ETHICS', 'AUDITOR'))
);

CREATE TABLE trials (
    id SERIAL PRIMARY KEY,
    trial_code VARCHAR(50) UNIQUE NOT NULL,
    title TEXT NOT NULL,
    phase VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    patient_code VARCHAR(50) UNIQUE NOT NULL,
    trial_id INT REFERENCES trials(id),
    prakriti_baseline VARCHAR(50),
    status VARCHAR(20) DEFAULT 'ENROLLED'
);

CREATE TABLE ecrf_entries (
    id SERIAL PRIMARY KEY,
    patient_id INT REFERENCES patients(id),
    visit_number INT NOT NULL,
    dosha_data JSONB NOT NULL, -- Stores Vata/Pitta/Kapha severity
    anupana_details TEXT,
    recorded_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    target_table VARCHAR(50) NOT NULL,
    record_id INT NOT NULL,
    payload JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);