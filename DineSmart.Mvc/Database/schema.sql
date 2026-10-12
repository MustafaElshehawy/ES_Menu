IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        Id NVARCHAR(80) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        Name NVARCHAR(80) NOT NULL,
        Email NVARCHAR(254) NOT NULL CONSTRAINT UQ_Users_Email UNIQUE,
        PasswordHash NVARCHAR(200) NOT NULL,
        ActiveStoreId NVARCHAR(80) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.Stores', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Stores (
        Id NVARCHAR(80) NOT NULL CONSTRAINT PK_Stores PRIMARY KEY,
        OwnerId NVARCHAR(80) NOT NULL,
        Slug NVARCHAR(90) NOT NULL CONSTRAINT UQ_Stores_Slug UNIQUE,
        Profile NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Stores_Profile DEFAULT N'{}',
        Theme NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Stores_Theme DEFAULT N'{"primary":"#2563eb","background":"#f8fafc"}',
        Currency NVARCHAR(4) NOT NULL CONSTRAINT DF_Stores_Currency DEFAULT N'SAR',
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Stores_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Stores_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Stores_Users FOREIGN KEY (OwnerId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
        CONSTRAINT CK_Stores_Profile CHECK (ISJSON(Profile) = 1),
        CONSTRAINT CK_Stores_Theme CHECK (ISJSON(Theme) = 1)
    );
    CREATE INDEX IX_Stores_OwnerId ON dbo.Stores(OwnerId);
END;

IF OBJECT_ID(N'dbo.Categories', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Categories (
        Id NVARCHAR(80) NOT NULL CONSTRAINT PK_Categories PRIMARY KEY,
        StoreId NVARCHAR(80) NOT NULL,
        Name NVARCHAR(MAX) NOT NULL,
        Icon NVARCHAR(12) NOT NULL CONSTRAINT DF_Categories_Icon DEFAULT N'🍽️',
        Image NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Categories_Image DEFAULT N'',
        SortOrder INT NOT NULL CONSTRAINT DF_Categories_SortOrder DEFAULT 0,
        CONSTRAINT FK_Categories_Stores FOREIGN KEY (StoreId) REFERENCES dbo.Stores(Id) ON DELETE CASCADE,
        CONSTRAINT CK_Categories_Name CHECK (ISJSON(Name) = 1)
    );
    CREATE INDEX IX_Categories_StoreId ON dbo.Categories(StoreId);
END;

IF COL_LENGTH(N'dbo.Categories', N'Image') IS NULL
BEGIN
    ALTER TABLE dbo.Categories ADD Image NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Categories_Image DEFAULT N'';
END;

IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products (
        Id NVARCHAR(80) NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
        StoreId NVARCHAR(80) NOT NULL,
        CategoryId NVARCHAR(80) NULL,
        Name NVARCHAR(MAX) NOT NULL,
        Description NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Products_Description DEFAULT N'{}',
        Ingredients NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Products_Ingredients DEFAULT N'{}',
        Price DECIMAL(12,2) NOT NULL,
        Calories INT NOT NULL CONSTRAINT DF_Products_Calories DEFAULT 0,
        Image NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Products_Image DEFAULT N'',
        Available BIT NOT NULL CONSTRAINT DF_Products_Available DEFAULT 1,
        SortOrder INT NOT NULL CONSTRAINT DF_Products_SortOrder DEFAULT 0,
        CONSTRAINT FK_Products_Stores FOREIGN KEY (StoreId) REFERENCES dbo.Stores(Id),
        CONSTRAINT FK_Products_Categories FOREIGN KEY (CategoryId) REFERENCES dbo.Categories(Id) ON DELETE SET NULL,
        CONSTRAINT CK_Products_Name CHECK (ISJSON(Name) = 1),
        CONSTRAINT CK_Products_Description CHECK (ISJSON(Description) = 1),
        CONSTRAINT CK_Products_Ingredients CHECK (ISJSON(Ingredients) = 1),
        CONSTRAINT CK_Products_Price CHECK (Price >= 0),
        CONSTRAINT CK_Products_Calories CHECK (Calories >= 0)
    );
    CREATE INDEX IX_Products_StoreId ON dbo.Products(StoreId);
    CREATE INDEX IX_Products_CategoryId ON dbo.Products(CategoryId);
END;