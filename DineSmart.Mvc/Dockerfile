FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY DineSmart.Mvc/DineSmart.Mvc.csproj DineSmart.Mvc/
RUN dotnet restore DineSmart.Mvc/DineSmart.Mvc.csproj
COPY . .
RUN dotnet publish DineSmart.Mvc/DineSmart.Mvc.csproj --configuration Release --output /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "DineSmart.Mvc.dll"]