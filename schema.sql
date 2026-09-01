CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    company_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    dts_license TEXT NOT NULL DEFAULT '',
    logo_data TEXT,
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    base_currency TEXT NOT NULL DEFAULT 'PKR',
    foreign_currency TEXT NOT NULL DEFAULT 'SAR',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    phone_normalized TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'VIEW_ONLY',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT '',
    UNIQUE(company_id, username)
  );

CREATE TABLE IF NOT EXISTS remembered_sessions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    record_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    account_type TEXT NOT NULL DEFAULT 'UNASSIGNED',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE IF NOT EXISTS unassigned_accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  );

CREATE INDEX IF NOT EXISTS idx_vendors_company_name ON vendors(company_id, name);
CREATE INDEX IF NOT EXISTS idx_unassigned_accounts_company_name ON unassigned_accounts(company_id, name);

CREATE TABLE IF NOT EXISTS payment_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    party_id TEXT,
    transaction_date TEXT NOT NULL,
    receipt_no TEXT NOT NULL DEFAULT '',
    from_account TEXT NOT NULL DEFAULT '',
    to_account TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    payment_type TEXT NOT NULL DEFAULT 'BANK',
    currency TEXT NOT NULL DEFAULT 'PKR',
    amount_entered REAL NOT NULL DEFAULT 0,
    sar REAL NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS package_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    package_description TEXT NOT NULL DEFAULT '',
    departure_date TEXT NOT NULL DEFAULT '',
    return_date TEXT NOT NULL DEFAULT '',
    no_of_days INTEGER NOT NULL DEFAULT 0,
    ziarat_included TEXT NOT NULL DEFAULT '',
    customer_contact TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_pkr REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS package_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    passenger_type TEXT NOT NULL,
    passenger_name TEXT NOT NULL DEFAULT '',
    package_type TEXT NOT NULL DEFAULT '',
    rate_per_person REAL NOT NULL DEFAULT 0,
    person_count INTEGER NOT NULL DEFAULT 0,
    qty_is_explicit INTEGER NOT NULL DEFAULT 1,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS app_migrations (
    migration_key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS ticket_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    airline_name TEXT NOT NULL DEFAULT '',
    pnr TEXT NOT NULL DEFAULT '',
    sector TEXT NOT NULL DEFAULT '',
    departure_date TEXT NOT NULL DEFAULT '',
    return_date TEXT NOT NULL DEFAULT '',
    flight_no TEXT NOT NULL DEFAULT '',
    departure_time TEXT NOT NULL DEFAULT '',
    arrival_time TEXT NOT NULL DEFAULT '',
    baggage TEXT NOT NULL DEFAULT '',
    ticket_status TEXT NOT NULL DEFAULT '',
    customer_contact TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_pkr REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE IF NOT EXISTS ticket_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    passenger_type TEXT NOT NULL,
    passenger_name TEXT NOT NULL DEFAULT '',
    airline_name TEXT NOT NULL DEFAULT '',
    pnr TEXT NOT NULL DEFAULT '',
    flight_type TEXT NOT NULL DEFAULT 'RETURN',
    ticket_route TEXT NOT NULL DEFAULT '',
    eticket_reference TEXT NOT NULL DEFAULT '',
    rate_per_ticket REAL NOT NULL DEFAULT 0,
    ticket_count INTEGER NOT NULL DEFAULT 1,
    qty_is_explicit INTEGER NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS hotel_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    confirmation_voucher TEXT NOT NULL DEFAULT '',
    meal_plan TEXT NOT NULL DEFAULT '',
    guest_family_name TEXT NOT NULL DEFAULT '',
    guest_count INTEGER NOT NULL DEFAULT 0,
    customer_contact TEXT NOT NULL DEFAULT '',
    special_requests TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE IF NOT EXISTS hotel_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    hotel_name TEXT NOT NULL DEFAULT '',
    check_in TEXT NOT NULL DEFAULT '',
    check_out TEXT NOT NULL DEFAULT '',
    nights INTEGER NOT NULL DEFAULT 0,
    room_type TEXT NOT NULL DEFAULT '',
    rate_per_night_sar REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS visa_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    expected_entry_date TEXT NOT NULL DEFAULT '',
    private_vehicle_type TEXT NOT NULL DEFAULT '',
    private_transport_total_sar REAL NOT NULL DEFAULT 0,
    intercity_bus_rate_sar REAL NOT NULL DEFAULT 0,
    intercity_bus_total_sar REAL NOT NULL DEFAULT 0,
    applicable_private_pax INTEGER NOT NULL DEFAULT 0,
    applicable_full_bus_pax INTEGER NOT NULL DEFAULT 0,
    visa_total_sar REAL NOT NULL DEFAULT 0,
    transport_total_sar REAL NOT NULL DEFAULT 0,
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE IF NOT EXISTS visa_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    passenger_type TEXT NOT NULL,
    passenger_name TEXT NOT NULL DEFAULT '',
    visa_type TEXT NOT NULL DEFAULT '',
    visa_rate_sar REAL NOT NULL DEFAULT 0,
    pax_count INTEGER NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    visa_total_sar REAL NOT NULL DEFAULT 0,
    private_transport_allocated_sar REAL NOT NULL DEFAULT 0,
    intercity_bus_total_sar REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS visa_transport_fleet (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    capacity_per_vehicle INTEGER NOT NULL DEFAULT 0,
    total_capacity INTEGER NOT NULL DEFAULT 0,
    rate_per_vehicle_sar REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS visa_passport_details (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    source_family_name TEXT NOT NULL DEFAULT '',
    passenger_name TEXT NOT NULL DEFAULT '',
    passenger_type TEXT NOT NULL DEFAULT 'ADULT',
    visa_type TEXT NOT NULL DEFAULT 'ONLY_UMRAH_VISA',
    surname TEXT NOT NULL DEFAULT '',
    given_name TEXT NOT NULL DEFAULT '',
    passport_number TEXT NOT NULL DEFAULT '',
    nationality TEXT NOT NULL DEFAULT '',
    date_of_birth TEXT NOT NULL DEFAULT '',
    passport_issuance TEXT NOT NULL DEFAULT '',
    passport_expiry TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS transport_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    pax_saudi_number TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE IF NOT EXISTS transport_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    transport_date TEXT NOT NULL DEFAULT '',
    transport_type TEXT NOT NULL DEFAULT '',
    from_location TEXT NOT NULL DEFAULT '',
    to_location TEXT NOT NULL DEFAULT '',
    vehicle_type TEXT NOT NULL DEFAULT '',
    custom_vehicle_name TEXT NOT NULL DEFAULT '',
    vehicle_count INTEGER NOT NULL DEFAULT 0,
    rate_sar REAL NOT NULL DEFAULT 0,
    pax_count INTEGER NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS hotel_commercial_guest_refs (
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        guest_name TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (company_id, booking_id, sort_order)
);
CREATE TABLE IF NOT EXISTS hotel_operational_reservations (
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        hotel_sort_order INTEGER NOT NULL DEFAULT 0,
        confirmation_voucher TEXT NOT NULL DEFAULT '',
        meal_plan TEXT NOT NULL DEFAULT '',
        reservation_status TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (company_id, booking_id, hotel_sort_order)
);
CREATE TABLE IF NOT EXISTS hotel_operational_guests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        given_name TEXT NOT NULL DEFAULT '',
        surname TEXT NOT NULL DEFAULT '',
        passport_number TEXT NOT NULL DEFAULT '',
        hotel_sort_order INTEGER NOT NULL DEFAULT 0,
        room_allocation TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

CREATE TABLE IF NOT EXISTS hotel_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        customer_contact TEXT NOT NULL DEFAULT '',
        special_requests TEXT NOT NULL DEFAULT '',
        checkin_instructions TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS misc_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE IF NOT EXISTS misc_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    service_name TEXT NOT NULL DEFAULT '',
    pax_count INTEGER NOT NULL DEFAULT 0,
    rate_per_person REAL NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    currency_mode TEXT NOT NULL DEFAULT 'PKR',
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS misc_commercial_family_refs (
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        family_head TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (company_id, booking_id, sort_order)
);
CREATE TABLE IF NOT EXISTS misc_operational_services (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        service_sort_order INTEGER NOT NULL DEFAULT 0,
        service_date TEXT NOT NULL DEFAULT '',
        reference_voucher TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

CREATE TABLE IF NOT EXISTS misc_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS package_booking_adjustments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS hotel_booking_adjustments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_hotel_booking_adjustments_lookup
  ON hotel_booking_adjustments(company_id, booking_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_hotel_booking_adjustments_date
  ON hotel_booking_adjustments(company_id, adjustment_date);

CREATE TABLE IF NOT EXISTS ticket_booking_adjustments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_ticket_booking_adjustments_lookup
  ON ticket_booking_adjustments(company_id, booking_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_ticket_booking_adjustments_date
  ON ticket_booking_adjustments(company_id, adjustment_date);

CREATE TABLE IF NOT EXISTS visa_booking_adjustments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_visa_booking_adjustments_lookup
  ON visa_booking_adjustments(company_id, booking_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_visa_booking_adjustments_date
  ON visa_booking_adjustments(company_id, adjustment_date);

CREATE TABLE IF NOT EXISTS transport_booking_adjustments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_transport_booking_adjustments_lookup
  ON transport_booking_adjustments(company_id, booking_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_transport_booking_adjustments_date
  ON transport_booking_adjustments(company_id, adjustment_date);

CREATE TABLE IF NOT EXISTS misc_booking_adjustments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_misc_booking_adjustments_lookup
  ON misc_booking_adjustments(company_id, booking_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_misc_booking_adjustments_date
  ON misc_booking_adjustments(company_id, adjustment_date);

CREATE TABLE IF NOT EXISTS package_operational_meta (booking_id TEXT PRIMARY KEY,company_id TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS package_operational_passengers (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,passenger_type TEXT NOT NULL,given_name TEXT NOT NULL DEFAULT '',surname TEXT NOT NULL DEFAULT '',passport_number TEXT NOT NULL DEFAULT '',visa_number TEXT NOT NULL DEFAULT '',passport_expiry TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS package_operational_hotels (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,city_name TEXT NOT NULL DEFAULT '',hotel_name TEXT NOT NULL DEFAULT '',check_in TEXT NOT NULL DEFAULT '',check_out TEXT NOT NULL DEFAULT '',nights INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS package_operational_flights (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,journey TEXT NOT NULL,flight_type TEXT NOT NULL DEFAULT 'DIRECT',departure_date TEXT NOT NULL DEFAULT '',pnr TEXT NOT NULL DEFAULT '',flight_no TEXT NOT NULL DEFAULT '',from_airport TEXT NOT NULL DEFAULT '',to_airport TEXT NOT NULL DEFAULT '',departure_time TEXT NOT NULL DEFAULT '',arrival_time TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS package_operational_flight_stopovers (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,journey TEXT NOT NULL,airport TEXT NOT NULL DEFAULT '',departure_date TEXT NOT NULL DEFAULT '',departure_time TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS package_movement_events (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT '',event_date TEXT NOT NULL DEFAULT '',event_time TEXT NOT NULL DEFAULT '',from_location TEXT NOT NULL DEFAULT '',to_location TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS payment_v2_meta (
      payment_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      transaction_kind TEXT NOT NULL DEFAULT 'PARTY_RECEIPT',
      settlement_account TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      bank_transaction_reference TEXT NOT NULL DEFAULT '',
      account_title TEXT NOT NULL DEFAULT '',
      account_last_digits TEXT NOT NULL DEFAULT '',
      cheque_no TEXT NOT NULL DEFAULT '',
      transfer_date TEXT NOT NULL DEFAULT '',
      handled_by TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      internal_notes TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      updated_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS payment_corrections (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      correction_no INTEGER NOT NULL DEFAULT 1,
      action TEXT NOT NULL DEFAULT 'CORRECTION',
      reason TEXT NOT NULL DEFAULT '',
      before_snapshot_json TEXT NOT NULL DEFAULT '{}',
      after_snapshot_json TEXT NOT NULL DEFAULT '{}',
      changed_fields_json TEXT NOT NULL DEFAULT '[]',
      corrected_by_user_id TEXT NOT NULL DEFAULT '',
      corrected_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS misc_booking_details (
    booking_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS ticket_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS ticket_operational_passengers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        passenger_type TEXT NOT NULL,
        given_name TEXT NOT NULL DEFAULT '',
        surname TEXT NOT NULL DEFAULT '',
        passport_number TEXT NOT NULL DEFAULT '',
        eticket_number TEXT NOT NULL DEFAULT '',
        passport_expiry TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

CREATE TABLE IF NOT EXISTS ticket_operational_flights (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        journey TEXT NOT NULL,
        flight_type TEXT NOT NULL DEFAULT 'DIRECT',
        departure_date TEXT NOT NULL DEFAULT '',
        airline_name TEXT NOT NULL DEFAULT '',
        pnr TEXT NOT NULL DEFAULT '',
        flight_no TEXT NOT NULL DEFAULT '',
        from_airport TEXT NOT NULL DEFAULT '',
        stopover_airport TEXT NOT NULL DEFAULT '',
        to_airport TEXT NOT NULL DEFAULT '',
        origin_departure TEXT NOT NULL DEFAULT '',
        stopover_departure_date TEXT NOT NULL DEFAULT '',
        stopover_departure_time TEXT NOT NULL DEFAULT '',
        destination_arrival TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

CREATE TABLE IF NOT EXISTS transport_operational_sectors (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        sector_sort_order INTEGER NOT NULL DEFAULT 0,
        pickup_time TEXT NOT NULL DEFAULT '',
        pickup_point TEXT NOT NULL DEFAULT '',
        driver_name TEXT NOT NULL DEFAULT '',
        driver_mobile TEXT NOT NULL DEFAULT '',
        vehicle_plate TEXT NOT NULL DEFAULT '',
        confirmation_reference TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

CREATE TABLE IF NOT EXISTS transport_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        passenger_saudi_contact TEXT NOT NULL DEFAULT '',
        group_family_head TEXT NOT NULL DEFAULT '',
        transport_instructions TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS visa_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        expected_entry_date TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS visa_operational_passengers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        source_family_name TEXT NOT NULL DEFAULT '',
        passenger_type TEXT NOT NULL,
        visa_type TEXT NOT NULL,
        given_name TEXT NOT NULL DEFAULT '',
        surname TEXT NOT NULL DEFAULT '',
        passport_number TEXT NOT NULL DEFAULT '',
        nationality TEXT NOT NULL DEFAULT '',
        date_of_birth TEXT NOT NULL DEFAULT '',
        passport_issuance TEXT NOT NULL DEFAULT '',
        passport_expiry TEXT NOT NULL DEFAULT '',
        visa_number TEXT NOT NULL DEFAULT '',
        mofa_reference TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );