-- Enable RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated users to insert companies" ON companies;
DROP POLICY IF EXISTS "Allow users to view their own company" ON companies;
DROP POLICY IF EXISTS "Allow users to update their own company" ON companies;
DROP POLICY IF EXISTS "Allow authenticated users to insert users" ON users;
DROP POLICY IF EXISTS "Allow users to view company users" ON users;
DROP POLICY IF EXISTS "Allow users to update company users" ON users;

-- Companies Policies
-- 1. Anyone who just signed up can insert a new company record
CREATE POLICY "Allow authenticated users to insert companies" 
  ON companies FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

-- 2. Users can only view their own company data
CREATE POLICY "Allow users to view their own company" 
  ON companies FOR SELECT 
  TO authenticated 
  USING (
    id = (auth.jwt()->'user_metadata'->>'company_id')::text
    OR EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = auth.uid()::text
        AND u.company_id = companies.id
    )
  );

-- 3. Users can only update their own company data
CREATE POLICY "Allow users to update their own company" 
  ON companies FOR UPDATE 
  TO authenticated 
  USING (
    id = (auth.jwt()->'user_metadata'->>'company_id')::text
    OR EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = auth.uid()::text
        AND u.company_id = companies.id
    )
  );

-- Users Policies
-- 1. Allow inserting new users (during setup or when creating employees)
CREATE POLICY "Allow authenticated users to insert users" 
  ON users FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

-- 2. Users can only view other users in their same company
CREATE POLICY "Allow users to view company users" 
  ON users FOR SELECT 
  TO authenticated 
  USING (
    company_id = (auth.jwt()->'user_metadata'->>'company_id')::text OR 
    id = auth.uid()::text
  );

-- 3. Users can update their own profile or their company's users
CREATE POLICY "Allow users to update company users" 
  ON users FOR UPDATE 
  TO authenticated 
  USING (
    company_id = (auth.jwt()->'user_metadata'->>'company_id')::text OR 
    id = auth.uid()::text
  );
