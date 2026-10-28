# Fresh Oracle installation

Use these steps for a new database only. The existing coursework installation already contains its tables and sample records. Keep its data and configuration.

## Container and application user

Install Docker Desktop on the Mac and allocate sufficient free disk space. Pull `container-registry.oracle.com/database/free:latest`. The coursework used the ARM64 image on Apple Silicon. Choose your own administrator password and pass it as ORACLE_PWD when starting the container. Use this container configuration:

```text
Name: medicare-oracle
Image: container-registry.oracle.com/database/free:latest
Restart: unless-stopped
Port: 127.0.0.1:1521:1521
Volume: medicare-oradata:/opt/oracle/oradata
Environment: ORACLE_PWD with your chosen administrator password
```

Wait for `DATABASE IS READY TO USE!` in the container logs. Open an administrative SQL*Plus session:

```bash
docker exec -it --user oracle medicare-oracle sqlplus / as sysdba
```

In SQL*Plus, switch to the application PDB and create the account. Replace the password placeholder locally with a password you choose before executing CREATE USER. Do not commit that edited command or password.

```sql
ALTER SESSION SET CONTAINER = FREEPDB1;
CREATE USER medicare IDENTIFIED BY "CHOOSE_YOUR_APP_PASSWORD"
  DEFAULT TABLESPACE users TEMPORARY TABLESPACE temp
  QUOTA 200M ON users;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE VIEW,
      CREATE PROCEDURE, CREATE TRIGGER TO medicare;
EXIT;
```

## Install the database

From the repository root on the Mac:

```bash
docker cp database medicare-oracle:/tmp/medicare_database
docker exec -it medicare-oracle sqlplus /nolog
```

Connect to MEDICARE with the chosen application password. A quoted password in a CONNECT command avoids ambiguity for characters such as @. Keep it local. Then execute in order:

```sql
SET DEFINE OFF
-- Connect as MEDICARE to //localhost:1521/FREEPDB1 before these scripts.
@/tmp/medicare_database/01_medicare_schema.sql
@/tmp/medicare_database/02_business_logic.sql
@/tmp/medicare_database/03_sample_data.sql
@/tmp/medicare_database/04_verify.sql
@/tmp/medicare_database/05_report_demo.sql
```

Run schema creation and sample seeding once on an empty application schema. The verification tests roll back their own fixtures. They may advance identity counters, so gaps in generated IDs are expected.

## Application configuration

Follow the root README for backend `.env`, `npm ci`, connection checks and starting both servers. The backend uses MEDICARE, FREEPDB1 and node-oracledb Thin mode. The frontend receives no database password. Initial seed counts and screenshots describe a demonstration snapshot; later manual tests add more records.
