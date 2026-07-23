


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cleanup_novacast_pairing_sessions"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.novacast_pairing_sessions
  set status = 'expired'
  where status = 'pending'
    and expires_at <= now();

  delete from public.novacast_pairing_sessions
  where (
    status in ('expired', 'consumed')
    and coalesce(consumed_at, claimed_at, expires_at, created_at) < now() - interval '1 day'
  )
  or (
    status = 'completed'
    and claimed_at < now() - interval '1 day'
  );
$$;


ALTER FUNCTION "public"."cleanup_novacast_pairing_sessions"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."novacast_pairing_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code_hash" "text" NOT NULL,
    "device_secret_hash" "text" NOT NULL,
    "device_name" "text" DEFAULT 'NovaCast Device'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "encrypted_payload" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "claimed_at" timestamp with time zone,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "novacast_pairing_sessions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'consumed'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."novacast_pairing_sessions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."novacast_pairing_sessions"
    ADD CONSTRAINT "novacast_pairing_sessions_code_hash_key" UNIQUE ("code_hash");



ALTER TABLE ONLY "public"."novacast_pairing_sessions"
    ADD CONSTRAINT "novacast_pairing_sessions_pkey" PRIMARY KEY ("id");



CREATE INDEX "novacast_pairing_sessions_device_lookup_idx" ON "public"."novacast_pairing_sessions" USING "btree" ("id", "device_secret_hash");



CREATE INDEX "novacast_pairing_sessions_expires_at_idx" ON "public"."novacast_pairing_sessions" USING "btree" ("expires_at");



CREATE INDEX "novacast_pairing_sessions_expiry_idx" ON "public"."novacast_pairing_sessions" USING "btree" ("expires_at");



ALTER TABLE "public"."novacast_pairing_sessions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."cleanup_novacast_pairing_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_novacast_pairing_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_novacast_pairing_sessions"() TO "service_role";


















GRANT ALL ON TABLE "public"."novacast_pairing_sessions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

revoke references on table "public"."novacast_pairing_sessions" from "anon";

revoke trigger on table "public"."novacast_pairing_sessions" from "anon";

revoke truncate on table "public"."novacast_pairing_sessions" from "anon";

revoke references on table "public"."novacast_pairing_sessions" from "authenticated";

revoke trigger on table "public"."novacast_pairing_sessions" from "authenticated";

revoke truncate on table "public"."novacast_pairing_sessions" from "authenticated";


