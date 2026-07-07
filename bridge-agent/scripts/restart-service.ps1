#Requires -RunAsAdministrator
param([string]$NssmPath = "nssm.exe")
& $NssmPath restart NoraMediBridge
& $NssmPath status NoraMediBridge
