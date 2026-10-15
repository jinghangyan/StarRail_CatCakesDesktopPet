using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AnimeStudio.CLI.Properties;
using Newtonsoft.Json;
using static AnimeStudio.CLI.Studio;

namespace AnimeStudio.CLI 
{
    public class Program
    {
        public static void Main(string[] args) => CommandLine.Init(args);

        public static void Run(Options o)
        {
            try
            {
                var game = GameManager.GetGame(o.GameName);

                // See https://github.com/Eleiyas/Z3-Asset-Map 
                var paths = File.Exists("./Maps/Z3-AssetIndex-Eleiyas.json")
                    ? JsonConvert.DeserializeObject<Dictionary<ulong, string>>(File.ReadAllText("./Maps/Z3-AssetIndex-Eleiyas.json"))
                    : new Dictionary<ulong, string>();

                Studio.Paths = paths;
                AssetsHelper.Paths = paths;

                if (game == null)
                {
                    Console.WriteLine("Invalid Game !!");
                    Console.WriteLine(GameManager.SupportedGames());
                    return;
                }

                if (game is UnityCNGame unityCNGame)
                {
                    UnityCN.SetKey(unityCNGame.Key);
                    Logger.Info($"[UnityCN] Selected Key is {unityCNGame.Key.Name} - {unityCNGame.Key.Key}");
                }

                Studio.Game = game;
                Logger.Default = new ConsoleLogger();
                Logger.Flags = o.LoggerFlags.Aggregate((e, x) => e |= x);
                Logger.FileLogging = Settings.Default.enableFileLogging;
                AssetsHelper.Minimal = Settings.Default.minimalAssetMap;
                AssetsHelper.SetUnityVersion(o.UnityVersion);

                TypeFlags.SetTypes(JsonConvert.DeserializeObject<Dictionary<ClassIDType, (bool, bool)>>(Settings.Default.types));

                var classTypeFilter = Array.Empty<ClassIDType>();
                if (!o.TypeFilter.IsNullOrEmpty())
                {
                    var exportTexture2D = false;
                    var exportMaterial = false;
                    var classTypeFilterList = new List<ClassIDType>();
                    for (int i = 0; i < o.TypeFilter.Length; i++)
                    {
                        var typeStr = o.TypeFilter[i];
                        var type = ClassIDType.UnknownType;
                        var flag = TypeFlag.Both;
                    
                        try
                        {
                            if (typeStr.Contains(':'))
                            {
                                var param = typeStr.Split(':');
                    
                                flag = (TypeFlag)Enum.Parse(typeof(TypeFlag), param[1], true);
                    
                                typeStr = param[0];
                            }
                    
                            type = (ClassIDType)Enum.Parse(typeof(ClassIDType), typeStr, true);

                            if (type == ClassIDType.Texture2D)
                            {
                                exportTexture2D = flag.HasFlag(TypeFlag.Export);
                            }
                            else if (type == ClassIDType.Material)
                            {
                                exportMaterial = flag.HasFlag(TypeFlag.Export);
                            }
                    
                            TypeFlags.SetType(type, flag.HasFlag(TypeFlag.Parse), flag.HasFlag(TypeFlag.Export));
                    
                            classTypeFilterList.Add(type);
                        }
                        catch(Exception e)
                        {
                            Logger.Error($"{typeStr} has invalid format, skipping...");
                            continue;
                        }
                    }

                    classTypeFilter = classTypeFilterList.ToArray();

                    if (ClassIDType.GameObject.CanExport() || ClassIDType.Animator.CanExport())
                    {
                        TypeFlags.SetType(ClassIDType.Texture2D, true, exportTexture2D);
                        if (Settings.Default.exportMaterials)
                        {
                            TypeFlags.SetType(ClassIDType.Material, true, exportMaterial);
                        }
                        if (ClassIDType.GameObject.CanExport())
                        {
                            TypeFlags.SetType(ClassIDType.Animator, true, true); // 桌宠项目补丁：不压制 Animator 导出
                        }
                        else if(ClassIDType.Animator.CanExport())
                        {
                            TypeFlags.SetType(ClassIDType.GameObject, true, false);
                        }
                    }
                }

                if (o.GroupAssetsType == AssetGroupOption.ByContainer)
                {
                    TypeFlags.SetType(ClassIDType.AssetBundle, true, false);
                }

                assetsManager.Silent = o.Silent;
                assetsManager.Game = game;
                assetsManager.SpecifyUnityVersion = o.UnityVersion;
                o.Output.Create();

                if (o.Key != default)
                {
                    MiHoYoBinData.Encrypted = true;
                    MiHoYoBinData.Key = o.Key;
                }

                if (o.AIFile != null && game.Type.IsGISubGroup())
                {
                    ResourceIndex.FromFile(o.AIFile.FullName);
                }

                if (o.DummyDllFolder != null)
                {
                    assemblyLoader.Load(o.DummyDllFolder.FullName);
                }

                Logger.Info("Scanning for files...");
                var files = o.Input.Attributes.HasFlag(FileAttributes.Directory) ? Directory.GetFiles(o.Input.FullName, "*.*", SearchOption.AllDirectories).OrderBy(x => x.Length).ToArray() : new string[] { o.Input.FullName };
                Logger.Info($"Found {files.Length} files");

                // 桌宠项目补丁8：一次性构建 CABMap（CAB→block+offset+依赖表）后退出，不进入导出。
                // 绝对路径会直接写到该路径（DumpCABMap 的 Path.Combine 遇根路径丢弃 "Maps" 前缀）。
                if (o.BuildCABMap != null)
                {
                    var cabMapPath = o.BuildCABMap.FullName;
                    if (cabMapPath.EndsWith(".bin", StringComparison.OrdinalIgnoreCase))
                        cabMapPath = cabMapPath.Substring(0, cabMapPath.Length - 4);
                    AssetsHelper.BuildCABMap(files, cabMapPath, o.Input.FullName, game);
                    return;
                }

                if (o.MapOp.HasFlag(MapOpType.CABMap))
                {
                    if (o.MapOp.HasFlag(MapOpType.Load))
                    {
                        AssetsHelper.BuildCABMap(files, o.MapName, o.Input.FullName, game);
                    }
                    else
                    {
                        AssetsHelper.LoadCABMapInternal(o.MapName);
                        assetsManager.ResolveDependencies = true;
                    }
                }
                if (o.MapOp.HasFlag(MapOpType.AssetMap))
                {
                    if (o.MapOp.HasFlag(MapOpType.Load))
                    {
                        files = AssetsHelper.ParseAssetMap(o.MapName, o.MapType, classTypeFilter, o.NameFilter, o.ContainerFilter);
                    }
                    else
                    {
                        Task.Run(() => AssetsHelper.BuildAssetMap(files, o.MapName, game, o.Output.FullName, o.MapType, classTypeFilter, o.NameFilter, o.ContainerFilter)).Wait();
                    }
                }
                if (o.MapOp.HasFlag(MapOpType.Both))
                {
                    Task.Run(() => AssetsHelper.BuildBoth(files, o.MapName, o.Input.FullName, game, o.Output.FullName, o.MapType, classTypeFilter, o.NameFilter, o.ContainerFilter)).Wait();
                }
                // 桌宠项目补丁8：加载 CABMap 并启用跨 block 依赖解析
                //（art prefab 的 SkinnedMeshRenderer.m_Mesh 等外部引用指向其它 block 的 CAB）。
                if (o.ResolveDependencies != null)
                {
                    if (AssetsHelper.LoadCABMap(o.ResolveDependencies.FullName))
                    {
                        assetsManager.ResolveDependencies = true;
                        Logger.Info($"Dependency resolution enabled with CABMap {o.ResolveDependencies.FullName}");
                    }
                    else
                    {
                        Logger.Warning($"CABMap {o.ResolveDependencies.FullName} failed to load, dependencies will NOT be resolved");
                    }
                }
                if (o.MapOp.Equals(MapOpType.None) || o.MapOp.HasFlag(MapOpType.Load))
                {
                    var i = 0;

                    var path = Path.GetDirectoryName(Path.GetFullPath(files[0]));
                    ImportHelper.MergeSplitAssets(path);
                    var toReadFile = ImportHelper.ProcessingSplitFiles(files.ToList());

                    var fileList = new List<string>(toReadFile);

                    // 桌宠项目补丁6：动画剪辑与 Animator/GameObject 常分属不同 block，逐 block 处理时
                    // CachedAnimationClips 只含当前 block 的剪辑，跨 block 的剪辑注入不到。
                    // AnimationClip 解析后是纯托管数据（StreamedClip.m_Data 等），源 block Clear 后仍可烘焙，
                    // 因此先跑一遍只收集剪辑（BuildAssetData 里按类型过滤器累积，见 Studio.cs），再跑正常导出。
                    var needClipPrepass = !classTypeFilter.IsNullOrEmpty()
                        && classTypeFilter.Contains(ClassIDType.AnimationClip)
                        && (classTypeFilter.Contains(ClassIDType.Animator) || classTypeFilter.Contains(ClassIDType.GameObject));
                    if (needClipPrepass)
                    {
                        // 补丁8兼容：剪辑自包含（纯托管数据），预收集遍不需要依赖解析，避免拖慢
                        var resolveDependencies = assetsManager.ResolveDependencies;
                        assetsManager.ResolveDependencies = false;
                        foreach (var file in fileList)
                        {
                            assetsManager.LoadFiles(file);
                            if (assetsManager.assetsFileList.Count > 0)
                            {
                                BuildAssetData(classTypeFilter, o.NameFilter, o.ContainerFilter, ref i);
                            }
                            exportableAssets.Clear();
                            assetsManager.Clear();
                        }
                        assetsManager.ResolveDependencies = resolveDependencies;
                        Logger.Info($"Pre-collected {Exporter.CachedAnimationClips?.Count ?? 0} AnimationClips for Animator/GameObject injection");
                    }

                    foreach (var file in fileList)
                    {
                        assetsManager.LoadFiles(file);
                        if (assetsManager.assetsFileList.Count > 0)
                        {
                            BuildAssetData(classTypeFilter, o.NameFilter, o.ContainerFilter, ref i);
                            ExportAssets(o.Output.FullName, exportableAssets, o.GroupAssetsType, o.AssetExportType);
                        }
                        exportableAssets.Clear();
                        assetsManager.Clear();
                    }
                }
                if (Properties.Settings.Default.scrapeMonos)
                {
                    File.WriteAllLines("./Maps/PathStrings_Sorted.txt", PathStrings.Distinct().OrderBy(p => p));
                    File.WriteAllLines("./Maps/VOStrings_Sorted.txt", VOStrings.Distinct().OrderBy(p => p));
                    File.WriteAllLines("./Maps/EventStrings_Sorted.txt", EventStrings.Distinct().OrderBy(p => p));
                }
            }
            catch (Exception e)
            {
                Console.WriteLine(e);
            }
        }
    }
}