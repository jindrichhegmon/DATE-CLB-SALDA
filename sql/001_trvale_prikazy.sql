-- Trvalé příkazy a pravidelné příjmy pro aplikaci Salda (CLB1). Idempotentní.
IF OBJECT_ID('dbo.Salda_TrvalePrikazy') IS NULL
CREATE TABLE dbo.Salda_TrvalePrikazy (
  Id          int IDENTITY(1,1) PRIMARY KEY,
  Firma       nvarchar(10)   NOT NULL,          -- CLB | DATEC
  Popis       nvarchar(300)  NOT NULL,
  Frekvence   nvarchar(40)   NOT NULL,          -- Měsíční, Čtvrtletní, Pololetní, Roční, Týdenní, 14 dní, Jednorázově
  Castka      decimal(18,2)  NOT NULL,          -- kladná = výdaj (trvalý příkaz), záporná = pravidelný příjem
  DatumPlatby date           NOT NULL,          -- referenční datum platby; další termíny se odvozují z frekvence
  SoftrId     nvarchar(50)   NULL,              -- původ záznamu při migraci ze Softr (jen informativní)
  Vytvoreno   datetime2      NOT NULL DEFAULT SYSDATETIME(),
  Zmeneno     datetime2      NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Salda_TrvalePrikazy_Firma')
  CREATE INDEX IX_Salda_TrvalePrikazy_Firma ON dbo.Salda_TrvalePrikazy (Firma, DatumPlatby);
